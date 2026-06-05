// SPDX-License-Identifier: AGPL-3.0-or-later

package crypto

import (
	"errors"
	"fmt"
)

// KeySize denotes a symmetric key length in bytes.
type KeySize int

const (
	// KeySize256 = 32-byte / 256-bit symmetric key (AES-256, HKDF-SHA256 output).
	KeySize256 KeySize = 32
)

// SymmetricKey is a DOMAIN-LEVEL opaque handle to 32 raw bytes. Callers may
// hold it as a value, compare it against another, and zero it. It exposes no
// crypto primitives - that's infrastructure's job.
//
// SECURITY: the underlying bytes are the secret itself. Do NOT log, do NOT
// format with %v, do NOT put inside error messages. Use the String() method
// which always returns the fixed token "[symmetric-key]".
type SymmetricKey struct {
	bytes []byte
}

// ErrInvalidKeySize is returned when a byte slice of unexpected length is
// passed to NewSymmetricKey.
var ErrInvalidKeySize = errors.New("crypto: invalid symmetric key size")

// NewSymmetricKey wraps b in a SymmetricKey after checking its length. The
// input is copied so the caller can zero it immediately.
func NewSymmetricKey(b []byte) (SymmetricKey, error) {
	if len(b) != int(KeySize256) {
		return SymmetricKey{}, fmt.Errorf("%w: got %d bytes, want %d", ErrInvalidKeySize, len(b), KeySize256)
	}
	buf := make([]byte, len(b))
	copy(buf, b)
	return SymmetricKey{bytes: buf}, nil
}

// Bytes returns a copy of the key material. Callers SHOULD zero the returned
// slice when done.
func (k SymmetricKey) Bytes() []byte {
	if k.bytes == nil {
		return nil
	}
	out := make([]byte, len(k.bytes))
	copy(out, k.bytes)
	return out
}

// Size returns the key length in bytes.
func (k SymmetricKey) Size() KeySize { return KeySize(len(k.bytes)) }

// IsZero reports whether the key has no material. A zero-value SymmetricKey
// returns true.
func (k SymmetricKey) IsZero() bool { return len(k.bytes) == 0 }

// String is fixed to prevent accidental key leaks through fmt/log.
func (k SymmetricKey) String() string { return "[symmetric-key]" }

// Zero scrubs the underlying buffer. Domain code calls this on lock; callers
// then drop the value. Safe on a zero-value key.
func (k *SymmetricKey) Zero() {
	for i := range k.bytes {
		k.bytes[i] = 0
	}
}

// PublicKey is an opaque container for serialised public-key bytes (RSA-OAEP
// or Ed25519). The domain holds bytes; the infrastructure layer parses them.
type PublicKey struct {
	raw []byte
}

// NewPublicKey wraps raw. Empty input is rejected.
func NewPublicKey(raw []byte) (PublicKey, error) {
	if len(raw) == 0 {
		return PublicKey{}, errors.New("crypto: empty public key")
	}
	buf := make([]byte, len(raw))
	copy(buf, raw)
	return PublicKey{raw: buf}, nil
}

// Bytes returns a copy of the serialised public key.
func (k PublicKey) Bytes() []byte {
	out := make([]byte, len(k.raw))
	copy(out, k.raw)
	return out
}

// IsZero reports whether the key is empty.
func (k PublicKey) IsZero() bool { return len(k.raw) == 0 }

// Signature is an Ed25519 signature (64 bytes). We keep domain validation
// strict so that forged short inputs are caught before they reach crypto.
type Signature struct {
	raw []byte
}

// Ed25519SignatureSize is the fixed Ed25519 signature length.
const Ed25519SignatureSize = 64

// ErrInvalidSignature marks a syntactically malformed signature. Cryptographic
// verification failure is a separate concern, surfaced by infrastructure.
var ErrInvalidSignature = errors.New("crypto: invalid signature")

// NewEd25519Signature wraps a 64-byte signature.
func NewEd25519Signature(raw []byte) (Signature, error) {
	if len(raw) != Ed25519SignatureSize {
		return Signature{}, fmt.Errorf("%w: got %d bytes, want %d", ErrInvalidSignature, len(raw), Ed25519SignatureSize)
	}
	buf := make([]byte, len(raw))
	copy(buf, raw)
	return Signature{raw: buf}, nil
}

// Bytes returns a copy of the signature bytes.
func (s Signature) Bytes() []byte {
	out := make([]byte, len(s.raw))
	copy(out, s.raw)
	return out
}

// IsZero reports whether the signature is empty.
func (s Signature) IsZero() bool { return len(s.raw) == 0 }
