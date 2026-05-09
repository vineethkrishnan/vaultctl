// SPDX-License-Identifier: AGPL-3.0-or-later

package clientcrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"

	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// ErrInvalidKeySize is returned when a caller passes a non-32-byte symmetric
// key to the client-side AEAD helpers.
var ErrInvalidKeySize = errors.New("clientcrypto: aead key must be 32 bytes")

// ErrWrongAlgorithm is returned when Decrypt receives a blob with a different
// alg_id than AES-256-GCM.
var ErrWrongAlgorithm = errors.New("clientcrypto: blob is not AES-256-GCM")

// Encrypt seals plaintext with AES-256-GCM under the 32-byte key and returns
// a v1 EncryptedBlob matching the wire format defined in
// internal/domain/crypto. Nonce is 12 random bytes drawn from crypto/rand.
func Encrypt(key, plaintext, aad []byte) (domaincrypto.EncryptedBlob, error) {
	if len(key) != 32 {
		return domaincrypto.EncryptedBlob{}, ErrInvalidKeySize
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return domaincrypto.EncryptedBlob{}, fmt.Errorf("clientcrypto: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return domaincrypto.EncryptedBlob{}, fmt.Errorf("clientcrypto: new gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return domaincrypto.EncryptedBlob{}, fmt.Errorf("clientcrypto: read nonce: %w", err)
	}

	// Seal returns ciphertext||tag. Split the trailing 16-byte tag so the
	// blob wire format stays { version | alg | nonce | ciphertext | tag }.
	sealed := gcm.Seal(nil, nonce, plaintext, aad)
	tagLen := gcm.Overhead()
	ctLen := len(sealed) - tagLen
	return domaincrypto.EncryptedBlob{
		Version:    domaincrypto.V1,
		Alg:        domaincrypto.AlgAES256GCM,
		Nonce:      nonce,
		Ciphertext: sealed[:ctLen],
		Tag:        sealed[ctLen:],
	}, nil
}

// Decrypt verifies and opens an AES-256-GCM EncryptedBlob under the 32-byte
// key and returns the plaintext. Blob validation is performed before
// primitive work.
func Decrypt(key []byte, blob domaincrypto.EncryptedBlob, aad []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, ErrInvalidKeySize
	}
	if err := blob.Validate(); err != nil {
		return nil, err
	}
	if blob.Alg != domaincrypto.AlgAES256GCM {
		return nil, fmt.Errorf("%w: alg=%s", ErrWrongAlgorithm, blob.Alg)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("clientcrypto: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("clientcrypto: new gcm: %w", err)
	}

	sealed := make([]byte, 0, len(blob.Ciphertext)+len(blob.Tag))
	sealed = append(sealed, blob.Ciphertext...)
	sealed = append(sealed, blob.Tag...)
	return gcm.Open(nil, blob.Nonce, sealed, aad)
}
