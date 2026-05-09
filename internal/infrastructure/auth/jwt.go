// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/secure"
)

// JWTKey identifies a single signing key in the keyring. The kid is
// surfaced on every issued token's header so verifiers can pick the right
// key without guessing. Secret holds the raw HMAC key bytes that the
// constructor copies into a memguard-backed Secret; callers MUST NOT
// retain the slice past NewJWTService.
type JWTKey struct {
	Kid    string
	Secret []byte
}

// secureKey is the internal, post-construction representation of a JWTKey
// where the raw bytes have been moved into a memguard LockedBuffer.
type secureKey struct {
	kid    string
	secret *secure.Secret
}

// JWTConfig drives the JWTService. Current is the key that signs NEW
// tokens; Next (optional) is accepted during verification but never signs —
// see H8 rotation procedure.
type JWTConfig struct {
	Current   JWTKey
	Next      *JWTKey
	Issuer    string
	AccessTTL time.Duration
	// NowFunc is the time source used for both issuing and verification.
	// Leaving it nil falls back to time.Now. Injecting a stable clock is
	// required for deterministic tests and for use cases that must pin a
	// single "now" across multiple adapter calls.
	NowFunc func() time.Time
}

// ErrJWTMisconfigured signals that the service cannot operate safely.
var ErrJWTMisconfigured = errors.New("jwt: misconfigured")

// AccessClaims is the payload signed into every access token. We keep it
// minimal: subject, a numeric rank (for quick admin gating in middleware),
// and the step-up flag used by H10-protected endpoints.
type AccessClaims struct {
	UserID string `json:"sub"`
	Role   string `json:"role"`
	// StepUpExp is the unix seconds until which a fresh master-password
	// proof is considered valid. Zero means NO step-up claim is present.
	StepUpExp int64 `json:"step_up_exp,omitempty"`
	jwt.RegisteredClaims
}

// JWTService issues and verifies access tokens.
type JWTService struct {
	current   secureKey
	next      *secureKey
	issuer    string
	accessTTL time.Duration
	nowFunc   func() time.Time
}

// NewJWTService constructs the service from cfg. Returns ErrJWTMisconfigured
// if Current.Secret is empty or AccessTTL is non-positive.
func NewJWTService(cfg JWTConfig) (*JWTService, error) {
	if len(cfg.Current.Secret) == 0 || strings.TrimSpace(cfg.Current.Kid) == "" {
		return nil, fmt.Errorf("%w: current key required", ErrJWTMisconfigured)
	}
	if cfg.AccessTTL <= 0 {
		return nil, fmt.Errorf("%w: access TTL must be > 0", ErrJWTMisconfigured)
	}
	if cfg.Issuer == "" {
		cfg.Issuer = "vaultctl"
	}
	if cfg.Next != nil && cfg.Next.Kid == cfg.Current.Kid {
		return nil, fmt.Errorf("%w: next kid must differ from current", ErrJWTMisconfigured)
	}
	if cfg.NowFunc == nil {
		cfg.NowFunc = time.Now
	}
	svc := &JWTService{
		current: secureKey{
			kid:    cfg.Current.Kid,
			secret: secure.NewSecretFromBytes(cfg.Current.Secret),
		},
		issuer:    cfg.Issuer,
		accessTTL: cfg.AccessTTL,
		nowFunc:   cfg.NowFunc,
	}
	if cfg.Next != nil && len(cfg.Next.Secret) > 0 {
		svc.next = &secureKey{
			kid:    cfg.Next.Kid,
			secret: secure.NewSecretFromBytes(cfg.Next.Secret),
		}
	}
	return svc, nil
}

// Close wipes all stored signing keys. Call from shutdown.
func (s *JWTService) Close() {
	s.current.secret.Destroy()
	if s.next != nil {
		s.next.secret.Destroy()
	}
}

// Issue signs a new access token for userID. now is injected for testability.
func (s *JWTService) Issue(userID, role string, now time.Time, stepUpUntil time.Time) (string, error) {
	claims := AccessClaims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.issuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.accessTTL)),
			NotBefore: jwt.NewNumericDate(now),
		},
	}
	if !stepUpUntil.IsZero() {
		claims.StepUpExp = stepUpUntil.Unix()
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tok.Header["kid"] = s.current.kid

	var signed string
	var signErr error
	s.current.secret.Open(func(key []byte) {
		signed, signErr = tok.SignedString(key)
	})
	return signed, signErr
}

// ErrInvalidToken is returned for any signature / expiry / structural
// verification failure.
var ErrInvalidToken = errors.New("jwt: invalid token")

// Verify parses and validates token. Picks the signing key by kid header,
// accepting both Current and Next so that rotation windows are seamless (H8).
func (s *JWTService) Verify(tokenString string) (*AccessClaims, error) {
	out := &AccessClaims{}
	parserOpts := []jwt.ParserOption{
		jwt.WithIssuer(s.issuer),
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithTimeFunc(s.nowFunc),
	}
	_, err := jwt.ParseWithClaims(tokenString, out, func(tok *jwt.Token) (any, error) {
		if _, ok := tok.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("%w: unexpected alg %v", ErrInvalidToken, tok.Method.Alg())
		}
		kid, _ := tok.Header["kid"].(string)
		switch kid {
		case s.current.kid:
			return borrowKey(s.current.secret), nil
		case "":
			return nil, fmt.Errorf("%w: missing kid", ErrInvalidToken)
		default:
			if s.next != nil && s.next.kid == kid {
				return borrowKey(s.next.secret), nil
			}
			return nil, fmt.Errorf("%w: unknown kid %q", ErrInvalidToken, kid)
		}
	}, parserOpts...)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err) //nolint:errorlint // wrap sentinel only
	}
	return out, nil
}

// borrowKey copies the Secret's bytes into a transient slice for the JWT
// library's verification callback. The copy is unavoidable: jwt.ParseWith-
// Claims is a pull-based API that can't run inside Secret.Open's closure.
// The returned slice is short-lived and garbage-collected after the parse.
func borrowKey(s *secure.Secret) []byte {
	return secure.WithBytes(s, func(b []byte) []byte {
		out := make([]byte, len(b))
		copy(out, b)
		return out
	})
}

// HasValidStepUp reports whether the token still carries a fresh step-up
// claim at `now` (H10). Tokens without step_up_exp return false.
func (c *AccessClaims) HasValidStepUp(now time.Time) bool {
	if c.StepUpExp == 0 {
		return false
	}
	return time.Unix(c.StepUpExp, 0).After(now)
}
