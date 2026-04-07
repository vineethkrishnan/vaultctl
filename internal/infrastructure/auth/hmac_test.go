package auth

import (
	"bytes"
	"errors"
	"testing"
)

func newTestHMAC(t *testing.T) *HMACService {
	t.Helper()
	h, err := NewHMACService("server-pepper-xxxxxxxxxxxxxxxxxxx", "enum-pepper-yyyyyyyyyyyyyyyyyyy")
	if err != nil {
		t.Fatalf("NewHMACService: %v", err)
	}
	return h
}

func TestNewHMACService_RequiresPeppers(t *testing.T) {
	t.Parallel()
	cases := [][2]string{
		{"", "enum"},
		{"server", ""},
		{"   ", "enum"},
	}
	for _, tc := range cases {
		if _, err := NewHMACService(tc[0], tc[1]); !errors.Is(err, ErrEmptyPepper) {
			t.Fatalf("(%q,%q): expected ErrEmptyPepper, got %v", tc[0], tc[1], err)
		}
	}
}

func TestHMACService_HashDeterministic(t *testing.T) {
	t.Parallel()
	h := newTestHMAC(t)
	a := h.HashString("refresh.token.abc")
	b := h.HashString("refresh.token.abc")
	if !bytes.Equal(a, b) {
		t.Fatalf("HMAC must be deterministic for same input")
	}
	if len(a) != 32 {
		t.Fatalf("SHA-256 output len = %d, want 32", len(a))
	}
	c := h.HashString("refresh.token.def")
	if bytes.Equal(a, c) {
		t.Fatalf("different inputs produced identical HMAC")
	}
}

func TestHMACService_HashBytesMatchesString(t *testing.T) {
	t.Parallel()
	h := newTestHMAC(t)
	str := h.HashString("token")
	byt := h.Hash([]byte("token"))
	if !bytes.Equal(str, byt) {
		t.Fatalf("Hash / HashString diverged")
	}
}

func TestHMACService_Equal_ConstantTime(t *testing.T) {
	t.Parallel()
	h := newTestHMAC(t)
	x := h.HashString("same")
	y := h.HashString("same")
	if !h.Equal(x, y) {
		t.Fatalf("identical hashes should Equal")
	}
	if h.Equal(x, h.HashString("other")) {
		t.Fatalf("different inputs should not Equal")
	}
	if h.Equal(x, nil) {
		t.Fatalf("nil should not Equal")
	}
}

func TestHMACService_EnumerationSaltIndependent(t *testing.T) {
	t.Parallel()
	h := newTestHMAC(t)
	// Same plaintext to HashString and EnumerationSalt should NOT produce
	// the same bytes because the peppers differ. This is the whole point
	// of H2's separate enumeration pepper.
	a := h.HashString("alice@example.com")
	b := h.EnumerationSalt("alice@example.com")
	if bytes.Equal(a, b) {
		t.Fatalf("enumeration salt must use a DIFFERENT pepper from token hashing (H2)")
	}
	// EnumerationSalt is deterministic.
	if !bytes.Equal(b, h.EnumerationSalt("alice@example.com")) {
		t.Fatalf("EnumerationSalt must be deterministic")
	}
}
