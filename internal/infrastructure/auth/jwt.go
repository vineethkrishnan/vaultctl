package auth

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWTKey identifies a single signing key in the keyring. The kid is
// surfaced on every issued token's header so verifiers can pick the right
// key without guessing.
type JWTKey struct {
	Kid    string
	Secret []byte
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
	cfg JWTConfig
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
	return &JWTService{cfg: cfg}, nil
}

// Issue signs a new access token for userID. now is injected for testability.
func (s *JWTService) Issue(userID, role string, now time.Time, stepUpUntil time.Time) (string, error) {
	claims := AccessClaims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.cfg.Issuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.cfg.AccessTTL)),
			NotBefore: jwt.NewNumericDate(now),
		},
	}
	if !stepUpUntil.IsZero() {
		claims.StepUpExp = stepUpUntil.Unix()
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tok.Header["kid"] = s.cfg.Current.Kid
	return tok.SignedString(s.cfg.Current.Secret)
}

// ErrInvalidToken is returned for any signature / expiry / structural
// verification failure.
var ErrInvalidToken = errors.New("jwt: invalid token")

// Verify parses and validates token. Picks the signing key by kid header,
// accepting both Current and Next so that rotation windows are seamless (H8).
func (s *JWTService) Verify(tokenString string) (*AccessClaims, error) {
	out := &AccessClaims{}
	parserOpts := []jwt.ParserOption{
		jwt.WithIssuer(s.cfg.Issuer),
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithTimeFunc(s.cfg.NowFunc),
	}
	_, err := jwt.ParseWithClaims(tokenString, out, func(tok *jwt.Token) (any, error) {
		if _, ok := tok.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("%w: unexpected alg %v", ErrInvalidToken, tok.Method.Alg())
		}
		kid, _ := tok.Header["kid"].(string)
		switch kid {
		case s.cfg.Current.Kid:
			return s.cfg.Current.Secret, nil
		case "":
			return nil, fmt.Errorf("%w: missing kid", ErrInvalidToken)
		default:
			if s.cfg.Next != nil && s.cfg.Next.Kid == kid {
				return s.cfg.Next.Secret, nil
			}
			return nil, fmt.Errorf("%w: unknown kid %q", ErrInvalidToken, kid)
		}
	}, parserOpts...)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}
	return out, nil
}

// HasValidStepUp reports whether the token still carries a fresh step-up
// claim at `now` (H10). Tokens without step_up_exp return false.
func (c *AccessClaims) HasValidStepUp(now time.Time) bool {
	if c.StepUpExp == 0 {
		return false
	}
	return time.Unix(c.StepUpExp, 0).After(now)
}
