package clientcrypto

import (
	"crypto/aes"
	"encoding/binary"
	"errors"

	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// ErrAESKWIntegrity is returned when the AES-KW integrity check fails
// (the recovered IV doesn't match the default IV from RFC 3394 §2.2.3.1).
var ErrAESKWIntegrity = errors.New("clientcrypto: AES-KW integrity check failed")

// defaultIV is the default initial value from RFC 3394 §2.2.3.1.
var defaultIV = [8]byte{0xA6, 0xA6, 0xA6, 0xA6, 0xA6, 0xA6, 0xA6, 0xA6}

// AESKeyUnwrap implements the AES Key Unwrap algorithm from RFC 3394 / NIST
// SP 800-38F. It expects a 32-byte KEK and an EncryptedBlob with AlgAES256KW.
// The blob's Tag field carries the 8-byte integrity check value (A) and
// Ciphertext carries the wrapped key blocks (R1..Rn).
func AESKeyUnwrap(kek []byte, blob domaincrypto.EncryptedBlob) ([]byte, error) {
	if len(kek) != 32 {
		return nil, ErrInvalidKeySize
	}
	if blob.Alg != domaincrypto.AlgAES256KW {
		return nil, errors.New("clientcrypto: blob is not AES-256-KW")
	}
	if len(blob.Tag) != 8 {
		return nil, errors.New("clientcrypto: AES-KW tag must be 8 bytes")
	}
	if len(blob.Ciphertext) == 0 || len(blob.Ciphertext)%8 != 0 {
		return nil, errors.New("clientcrypto: AES-KW ciphertext must be a multiple of 8 bytes")
	}

	block, err := aes.NewCipher(kek)
	if err != nil {
		return nil, err
	}

	n := len(blob.Ciphertext) / 8

	// Initialize A and R from the blob
	var a [8]byte
	copy(a[:], blob.Tag)

	r := make([]byte, len(blob.Ciphertext))
	copy(r, blob.Ciphertext)

	// Unwrap: for j = 5 downto 0, for i = n downto 1
	var buf [16]byte
	for j := 5; j >= 0; j-- {
		for i := n; i >= 1; i-- {
			// t = n*j + i
			t := uint64(n*j + i)

			// XOR A with t
			copy(buf[:8], a[:])
			tBytes := [8]byte{}
			binary.BigEndian.PutUint64(tBytes[:], t)
			for k := 0; k < 8; k++ {
				buf[k] ^= tBytes[k]
			}

			// Copy R[i] (0-indexed: R[(i-1)*8 : i*8])
			copy(buf[8:], r[(i-1)*8:i*8])

			// AES decrypt
			block.Decrypt(buf[:], buf[:])

			// Split result
			copy(a[:], buf[:8])
			copy(r[(i-1)*8:i*8], buf[8:])
		}
	}

	// Verify integrity
	if a != defaultIV {
		return nil, ErrAESKWIntegrity
	}

	return r, nil
}
