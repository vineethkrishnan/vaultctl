package auth

import (
	"strings"
	"testing"
)

func TestTokenGenerator_RefreshTokenUnique(t *testing.T) {
	t.Parallel()
	g := NewTokenGenerator()
	seen := make(map[string]struct{}, 100)
	for i := 0; i < 100; i++ {
		tok, err := g.RefreshToken()
		if err != nil {
			t.Fatalf("RefreshToken: %v", err)
		}
		if _, dup := seen[tok]; dup {
			t.Fatalf("collision on iteration %d", i)
		}
		seen[tok] = struct{}{}
	}
}

func TestTokenGenerator_RefreshTokenEntropy(t *testing.T) {
	t.Parallel()
	g := NewTokenGenerator()
	tok, err := g.RefreshToken()
	if err != nil {
		t.Fatalf("RefreshToken: %v", err)
	}
	// 32 bytes of entropy => 43 base64-url chars (no padding).
	if len(tok) != 43 {
		t.Fatalf("unexpected length %d, want 43 base64-url chars", len(tok))
	}
}

func TestTokenGenerator_APIKeyPrefix(t *testing.T) {
	t.Parallel()
	g := NewTokenGenerator()
	key, err := g.APIKey()
	if err != nil {
		t.Fatalf("APIKey: %v", err)
	}
	if !strings.HasPrefix(key, APIKeyPrefix) {
		t.Fatalf("missing prefix: %q", key)
	}
	if len(strings.TrimPrefix(key, APIKeyPrefix)) != 43 {
		t.Fatalf("unexpected body len: %q", key)
	}
}

func TestTokenGenerator_InviteToken(t *testing.T) {
	t.Parallel()
	g := NewTokenGenerator()
	a, err := g.InviteToken()
	if err != nil {
		t.Fatalf("InviteToken: %v", err)
	}
	if len(a) != 43 {
		t.Fatalf("unexpected length %d", len(a))
	}
	b, _ := g.InviteToken()
	if a == b {
		t.Fatalf("invite tokens should be unique")
	}
}
