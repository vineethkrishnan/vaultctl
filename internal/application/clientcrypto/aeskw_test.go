// SPDX-License-Identifier: AGPL-3.0-or-later

package clientcrypto

import (
	"bytes"
	"crypto/aes"
	"encoding/binary"
	"testing"

	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// aesKeyWrap implements the wrap direction so we can test round-trip.
func aesKeyWrap(kek, plaintext []byte) (tag [8]byte, ciphertext []byte, err error) {
	if len(kek) != 32 {
		return tag, nil, ErrInvalidKeySize
	}
	if len(plaintext) == 0 || len(plaintext)%8 != 0 {
		return tag, nil, ErrAESKWIntegrity
	}
	block, err := aes.NewCipher(kek)
	if err != nil {
		return tag, nil, err
	}

	n := len(plaintext) / 8
	a := defaultIV
	r := make([]byte, len(plaintext))
	copy(r, plaintext)

	var buf [16]byte
	for j := 0; j <= 5; j++ {
		for i := 1; i <= n; i++ {
			copy(buf[:8], a[:])
			copy(buf[8:], r[(i-1)*8:i*8])
			block.Encrypt(buf[:], buf[:])
			copy(a[:], buf[:8])

			t := uint64(n*j + i)
			tBytes := [8]byte{}
			binary.BigEndian.PutUint64(tBytes[:], t)
			for k := 0; k < 8; k++ {
				a[k] ^= tBytes[k]
			}
			copy(r[(i-1)*8:i*8], buf[8:])
		}
	}
	return a, r, nil
}

func TestAESKeyUnwrap_RoundTrip(t *testing.T) {
	kek := bytes.Repeat([]byte{0x42}, 32)
	plaintext := bytes.Repeat([]byte{0xDE}, 32) // 32 bytes = a 256-bit key

	tag, ciphertext, err := aesKeyWrap(kek, plaintext)
	if err != nil {
		t.Fatalf("wrap: %v", err)
	}

	blob := domaincrypto.EncryptedBlob{
		Version:    domaincrypto.V1,
		Alg:        domaincrypto.AlgAES256KW,
		Nonce:      nil,
		Ciphertext: ciphertext,
		Tag:        tag[:],
	}

	got, err := AESKeyUnwrap(kek, blob)
	if err != nil {
		t.Fatalf("unwrap: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("unwrap mismatch: got %x, want %x", got, plaintext)
	}
}

func TestAESKeyUnwrap_BadKEK(t *testing.T) {
	kek := bytes.Repeat([]byte{0x42}, 32)
	plaintext := bytes.Repeat([]byte{0xDE}, 32)

	tag, ciphertext, err := aesKeyWrap(kek, plaintext)
	if err != nil {
		t.Fatalf("wrap: %v", err)
	}

	blob := domaincrypto.EncryptedBlob{
		Version:    domaincrypto.V1,
		Alg:        domaincrypto.AlgAES256KW,
		Ciphertext: ciphertext,
		Tag:        tag[:],
	}

	badKEK := bytes.Repeat([]byte{0x00}, 32)
	_, err = AESKeyUnwrap(badKEK, blob)
	if err != ErrAESKWIntegrity {
		t.Fatalf("expected integrity error, got: %v", err)
	}
}

func TestAESKeyUnwrap_InvalidKeySize(t *testing.T) {
	blob := domaincrypto.EncryptedBlob{
		Version:    domaincrypto.V1,
		Alg:        domaincrypto.AlgAES256KW,
		Ciphertext: make([]byte, 16),
		Tag:        make([]byte, 8),
	}
	_, err := AESKeyUnwrap(make([]byte, 16), blob)
	if err != ErrInvalidKeySize {
		t.Fatalf("expected ErrInvalidKeySize, got: %v", err)
	}
}
