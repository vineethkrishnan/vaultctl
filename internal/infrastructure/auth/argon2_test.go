package auth

import (
	"errors"
	"strings"
	"testing"
)

// Argon2id is intentionally slow. We use minimum params for the unit tests.
func testParams() ServerArgon2Params {
	return ServerArgon2Params{
		Iterations: 1, MemoryKB: 8192, Parallelism: 1, SaltLen: 8, KeyLen: 16,
	}
}

func TestArgon2Hasher_RoundTrip(t *testing.T) {
	t.Parallel()
	h := NewArgon2Hasher(testParams())
	encoded, err := h.Hash([]byte("some-auth-hash"))
	if err != nil {
		t.Fatalf("Hash: %v", err)
	}
	if !strings.HasPrefix(encoded, phcPrefix) {
		t.Fatalf("encoded hash missing PHC prefix: %q", encoded)
	}

	ok, upgrade, err := h.Verify([]byte("some-auth-hash"), encoded)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !ok {
		t.Fatalf("correct password failed to verify")
	}
	if upgrade {
		t.Fatalf("same params should not trigger upgrade")
	}
}

func TestArgon2Hasher_WrongPassword(t *testing.T) {
	t.Parallel()
	h := NewArgon2Hasher(testParams())
	encoded, _ := h.Hash([]byte("right"))
	ok, _, err := h.Verify([]byte("wrong"), encoded)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if ok {
		t.Fatalf("wrong password verified")
	}
}

func TestArgon2Hasher_Upgrade(t *testing.T) {
	t.Parallel()
	weak := NewArgon2Hasher(testParams())
	strong := NewArgon2Hasher(ServerArgon2Params{
		Iterations: 2, MemoryKB: 16384, Parallelism: 1, SaltLen: 8, KeyLen: 16,
	})

	encoded, _ := weak.Hash([]byte("x"))
	ok, upgrade, err := strong.Verify([]byte("x"), encoded)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !ok {
		t.Fatalf("verify of weaker hash should still succeed")
	}
	if !upgrade {
		t.Fatalf("stored hash weaker than server defaults -> upgrade=true")
	}
}

func TestArgon2Hasher_MalformedHash(t *testing.T) {
	t.Parallel()
	h := NewArgon2Hasher(testParams())
	cases := []string{
		"",
		"plaintext",
		"$argon2i$v=19$m=8192,t=1,p=1$abc$def", // wrong algorithm
		"$argon2id$v=19$bad$salt$digest",       // bad params segment
		"$argon2id$v=19$m=1,t=1,p=1$!!!$def",   // bad salt b64
		"$argon2id$v=19$m=1,t=1,p=1$YWI$!!!",   // bad digest b64
		"$argon2id$v=19$m=1,t=1,p=1",           // too few segments
	}
	for _, enc := range cases {
		_, _, err := h.Verify([]byte("x"), enc)
		if !errors.Is(err, ErrMalformedPHC) {
			t.Fatalf("%q: expected ErrMalformedPHC, got %v", enc, err)
		}
	}
}

func TestArgon2Hasher_ZeroParamsDefault(t *testing.T) {
	t.Parallel()
	h := NewArgon2Hasher(ServerArgon2Params{})
	if h.Params.Iterations == 0 {
		t.Fatalf("zero params should fall through to defaults")
	}
	if h.Params.SaltLen == 0 || h.Params.KeyLen == 0 {
		t.Fatalf("defaults must fill SaltLen/KeyLen")
	}
}

func TestDefaultServerArgon2Params_FloorsOWASP(t *testing.T) {
	t.Parallel()
	p := DefaultServerArgon2Params()
	if p.MemoryKB < 19456 {
		t.Fatalf("OWASP 2023 floor breached: mem=%d", p.MemoryKB)
	}
	if p.Iterations < 1 || p.Parallelism < 1 {
		t.Fatalf("iter/par must be >= 1")
	}
}
