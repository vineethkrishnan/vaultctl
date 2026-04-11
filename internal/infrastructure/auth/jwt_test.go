package auth

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// frozen is a deterministic clock used across JWT tests. The token library's
// expiry validator follows NowFunc, so pinning it keeps tests stable.
var frozen = time.Unix(1_700_000_000, 0).UTC()

func newTestJWT(t *testing.T, next *JWTKey) *JWTService {
	t.Helper()
	s, err := NewJWTService(JWTConfig{
		Current:   JWTKey{Kid: "k1", Secret: []byte("current-secret-which-is-long-enough")},
		Next:      next,
		Issuer:    "vaultctl-test",
		AccessTTL: 15 * time.Minute,
		NowFunc:   func() time.Time { return frozen },
	})
	if err != nil {
		t.Fatalf("NewJWTService: %v", err)
	}
	return s
}

func TestJWTService_RoundTrip(t *testing.T) {
	t.Parallel()
	svc := newTestJWT(t, nil)
	now := frozen

	tok, err := svc.Issue("user-1", "member", now, time.Time{})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	claims, err := svc.Verify(tok)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.UserID != "user-1" {
		t.Fatalf("sub = %q, want user-1", claims.UserID)
	}
	if claims.Role != "member" {
		t.Fatalf("role = %q, want member", claims.Role)
	}
	if claims.HasValidStepUp(now) {
		t.Fatalf("no step-up claim -> must be false")
	}
}

func TestJWTService_StepUp(t *testing.T) {
	t.Parallel()
	svc := newTestJWT(t, nil)
	now := frozen
	stepUpUntil := now.Add(5 * time.Minute)

	tok, err := svc.Issue("u1", "admin", now, stepUpUntil)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	claims, err := svc.Verify(tok)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !claims.HasValidStepUp(now) {
		t.Fatalf("fresh step-up should be valid at `now`")
	}
	if !claims.HasValidStepUp(now.Add(4 * time.Minute)) {
		t.Fatalf("step-up should still be valid within window")
	}
	if claims.HasValidStepUp(now.Add(6 * time.Minute)) {
		t.Fatalf("step-up must expire past its Exp")
	}
}

func TestJWTService_Rotation_AcceptsNextKid(t *testing.T) {
	t.Parallel()
	// Old service signs with k1
	old := newTestJWT(t, nil)
	now := frozen
	tok, _ := old.Issue("u1", "member", now, time.Time{})

	// New service swaps k1 -> k2 as CURRENT, keeps k1 as NEXT during the
	// grace window. Tokens issued by `old` (kid=k1) must still verify.
	rotated, err := NewJWTService(JWTConfig{
		Current:   JWTKey{Kid: "k2", Secret: []byte("newer-secret-also-long-enough-xxx")},
		Next:      &JWTKey{Kid: "k1", Secret: []byte("current-secret-which-is-long-enough")},
		Issuer:    "vaultctl-test",
		AccessTTL: 15 * time.Minute,
		NowFunc:   func() time.Time { return frozen },
	})
	if err != nil {
		t.Fatalf("rotated: %v", err)
	}

	if _, err := rotated.Verify(tok); err != nil {
		t.Fatalf("rotation should accept tokens signed by old kid (H8): %v", err)
	}
}

func TestJWTService_Expired(t *testing.T) {
	t.Parallel()
	svc := newTestJWT(t, nil)
	// Issue a token at t=0, then ask the service to verify as if we are at
	// t=1h — well past the 15min TTL.
	now := frozen
	tok, _ := svc.Issue("u1", "member", now, time.Time{})

	laterSvc, _ := NewJWTService(JWTConfig{
		Current:   JWTKey{Kid: "k1", Secret: []byte("current-secret-which-is-long-enough")},
		Issuer:    "vaultctl-test",
		AccessTTL: 15 * time.Minute,
		NowFunc:   func() time.Time { return frozen.Add(1 * time.Hour) },
	})
	if _, err := laterSvc.Verify(tok); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("expired token: expected ErrInvalidToken, got %v", err)
	}
}

func TestJWTService_Reject(t *testing.T) {
	t.Parallel()
	svc := newTestJWT(t, nil)

	// Token signed by a different secret with an unknown kid -> reject
	other := newTestJWT(t, nil)
	// Reissue the same kid but with a different secret; this SHOULD fail
	// because verification pulls the wrong secret for the kid.
	otherSvc, _ := NewJWTService(JWTConfig{
		Current:   JWTKey{Kid: "zz", Secret: []byte("other-secret-long-enough-to-work")},
		Issuer:    "vaultctl-test",
		AccessTTL: 15 * time.Minute,
		NowFunc:   func() time.Time { return frozen },
	})
	now := frozen
	foreign, _ := otherSvc.Issue("u1", "member", now, time.Time{})
	if _, err := svc.Verify(foreign); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("foreign kid: expected ErrInvalidToken, got %v", err)
	}
	_ = other

	// Malformed
	if _, err := svc.Verify("not.a.jwt"); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("malformed: expected ErrInvalidToken, got %v", err)
	}
	if _, err := svc.Verify(""); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("empty: expected ErrInvalidToken, got %v", err)
	}

	// Garbage that looks JWT-shaped (three dot-separated segments)
	garbage := strings.Join([]string{"a", "b", "c"}, ".")
	if _, err := svc.Verify(garbage); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("garbage: expected ErrInvalidToken, got %v", err)
	}
}

func TestNewJWTService_RejectsMisconfiguration(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		cfg  JWTConfig
	}{
		{"empty secret", JWTConfig{Current: JWTKey{Kid: "k1"}, AccessTTL: time.Minute}},
		{"empty kid", JWTConfig{Current: JWTKey{Secret: []byte("s")}, AccessTTL: time.Minute}},
		{"zero TTL", JWTConfig{Current: JWTKey{Kid: "k1", Secret: []byte("s")}}},
		{"duplicate kid", JWTConfig{
			Current:   JWTKey{Kid: "k1", Secret: []byte("s")},
			Next:      &JWTKey{Kid: "k1", Secret: []byte("t")},
			AccessTTL: time.Minute,
		}},
	}
	for _, tc := range cases {
		if _, err := NewJWTService(tc.cfg); !errors.Is(err, ErrJWTMisconfigured) {
			t.Fatalf("%s: expected ErrJWTMisconfigured, got %v", tc.name, err)
		}
	}
}

func TestJWTService_DefaultsIssuer(t *testing.T) {
	t.Parallel()
	svc, err := NewJWTService(JWTConfig{
		Current:   JWTKey{Kid: "k1", Secret: []byte("secret-long-enough-for-hs256-mac")},
		AccessTTL: time.Minute,
	})
	if err != nil {
		t.Fatalf("NewJWTService: %v", err)
	}
	if svc.issuer != "vaultctl" {
		t.Fatalf("Issuer default not applied: %q", svc.issuer)
	}
}
