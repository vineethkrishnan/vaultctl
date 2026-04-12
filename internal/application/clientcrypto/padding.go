package clientcrypto

import (
	"crypto/subtle"
	"errors"
	"fmt"
)

// PaddingBlockSize matches web/src/shared/crypto/padding.ts — item and folder
// names are padded to a multiple of 32 bytes before encryption to avoid
// leaking plaintext length.
const PaddingBlockSize = 32

// ErrInvalidPadding is returned when PKCS#7 verification fails.
var ErrInvalidPadding = errors.New("clientcrypto: invalid PKCS#7 padding")

// Pad appends PKCS#7 padding to data so the output length is a multiple of
// PaddingBlockSize. If data is already aligned, a full block (32 bytes) of
// padding is appended — standard PKCS#7 behaviour.
func Pad(data []byte) []byte {
	padLen := PaddingBlockSize - (len(data) % PaddingBlockSize)
	padded := make([]byte, len(data)+padLen)
	copy(padded, data)
	for i := len(data); i < len(padded); i++ {
		padded[i] = byte(padLen)
	}
	return padded
}

// Unpad strips PKCS#7 padding and verifies it in constant time. The input
// must be a non-empty multiple of PaddingBlockSize.
func Unpad(padded []byte) ([]byte, error) {
	if len(padded) == 0 || len(padded)%PaddingBlockSize != 0 {
		return nil, fmt.Errorf("%w: length %d not a multiple of %d", ErrInvalidPadding, len(padded), PaddingBlockSize)
	}
	padLen := int(padded[len(padded)-1])
	if padLen < 1 || padLen > PaddingBlockSize || padLen > len(padded) {
		return nil, fmt.Errorf("%w: byte %d out of range", ErrInvalidPadding, padLen)
	}
	// Constant-time verification of every padding byte.
	expected := make([]byte, padLen)
	for i := range expected {
		expected[i] = byte(padLen)
	}
	if subtle.ConstantTimeCompare(padded[len(padded)-padLen:], expected) != 1 {
		return nil, ErrInvalidPadding
	}
	return padded[:len(padded)-padLen], nil
}
