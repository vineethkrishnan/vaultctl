package crypto

import (
	"bytes"
	"errors"
	"testing"
)

func TestSymmetricKey_NewAndBytes(t *testing.T) {
	t.Parallel()
	raw := bytes.Repeat([]byte{0xAA}, 32)
	k, err := NewSymmetricKey(raw)
	if err != nil {
		t.Fatalf("NewSymmetricKey: %v", err)
	}
	if k.Size() != KeySize256 {
		t.Fatalf("Size() = %d, want %d", k.Size(), KeySize256)
	}
	out := k.Bytes()
	if !bytes.Equal(out, raw) {
		t.Fatalf("Bytes() differs from input")
	}

	// Mutating the caller's input must NOT change the stored key.
	raw[0] = 0x00
	if k.Bytes()[0] != 0xAA {
		t.Fatalf("input mutation leaked into key")
	}
	// Mutating Bytes() output must NOT change the stored key.
	out[0] = 0x00
	if k.Bytes()[0] != 0xAA {
		t.Fatalf("output mutation leaked into key")
	}
}

func TestSymmetricKey_WrongSize(t *testing.T) {
	t.Parallel()
	cases := [][]byte{nil, {}, bytes.Repeat([]byte{0}, 16), bytes.Repeat([]byte{0}, 33)}
	for _, tc := range cases {
		if _, err := NewSymmetricKey(tc); !errors.Is(err, ErrInvalidKeySize) {
			t.Fatalf("len=%d: expected ErrInvalidKeySize, got %v", len(tc), err)
		}
	}
}

func TestSymmetricKey_StringMasks(t *testing.T) {
	t.Parallel()
	k, _ := NewSymmetricKey(bytes.Repeat([]byte{0x42}, 32))
	if k.String() != "[symmetric-key]" {
		t.Fatalf("String() leaked key material: %q", k.String())
	}
}

func TestSymmetricKey_Zero(t *testing.T) {
	t.Parallel()
	k, _ := NewSymmetricKey(bytes.Repeat([]byte{0x42}, 32))
	if k.IsZero() {
		t.Fatalf("fresh key should not report IsZero")
	}
	k.Zero()
	for _, b := range k.Bytes() {
		if b != 0 {
			t.Fatalf("Zero() did not scrub bytes")
		}
	}

	var empty SymmetricKey
	if !empty.IsZero() {
		t.Fatalf("zero-value key should IsZero")
	}
	empty.Zero() // must not panic
	if empty.Bytes() != nil {
		t.Fatalf("zero-value Bytes() should be nil")
	}
}

func TestPublicKey(t *testing.T) {
	t.Parallel()
	raw := []byte{0x30, 0x82, 0x01, 0x22}
	pk, err := NewPublicKey(raw)
	if err != nil {
		t.Fatalf("NewPublicKey: %v", err)
	}
	if pk.IsZero() {
		t.Fatalf("non-empty key should not IsZero")
	}
	out := pk.Bytes()
	if !bytes.Equal(out, raw) {
		t.Fatalf("Bytes() mismatch")
	}
	out[0] = 0xFF
	if pk.Bytes()[0] != 0x30 {
		t.Fatalf("Bytes() returned shared slice")
	}

	if _, err := NewPublicKey(nil); err == nil {
		t.Fatalf("empty public key should fail")
	}
	var zero PublicKey
	if !zero.IsZero() {
		t.Fatalf("zero-value PublicKey should IsZero")
	}
}

func TestSignature(t *testing.T) {
	t.Parallel()
	raw := bytes.Repeat([]byte{0x7E}, Ed25519SignatureSize)
	sig, err := NewEd25519Signature(raw)
	if err != nil {
		t.Fatalf("NewEd25519Signature: %v", err)
	}
	if sig.IsZero() {
		t.Fatalf("non-empty sig should not IsZero")
	}
	if !bytes.Equal(sig.Bytes(), raw) {
		t.Fatalf("Bytes() mismatch")
	}
	// copy-on-output
	sig.Bytes()[0] = 0xFF
	if sig.Bytes()[0] != 0x7E {
		t.Fatalf("Bytes() returned shared slice")
	}

	for _, badLen := range []int{0, 1, 63, 65, 128} {
		if _, err := NewEd25519Signature(bytes.Repeat([]byte{0}, badLen)); !errors.Is(err, ErrInvalidSignature) {
			t.Fatalf("len=%d: expected ErrInvalidSignature, got %v", badLen, err)
		}
	}
	var zero Signature
	if !zero.IsZero() {
		t.Fatalf("zero-value Signature should IsZero")
	}
}
