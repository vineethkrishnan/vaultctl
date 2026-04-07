// Package crypto hosts infrastructure crypto adapters. Unlike the
// internal/domain/crypto package (which only carries value objects), this
// package DOES perform cryptographic operations — and is therefore the only
// place in the codebase that imports crypto/aes, crypto/cipher, etc.
//
// Scope (M2):
//   - ServerAEAD: AES-256-GCM wrapper keyed off VAULTCTL_DATA_ENCRYPTION_KEY
//     (H5). Used to encrypt server-side fields like totp_secret and
//     password_hint. Supports dual-key decrypt for rotation.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"

	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// KeyBase64 is the encoding expected from env (openssl rand -base64 32).
const KeyBase64 = "base64"

// ErrBadDataKey is returned when the provided data-encryption key doesn't
// decode to exactly 32 bytes.
var ErrBadDataKey = errors.New("crypto: data encryption key must be 32 bytes (base64-encoded)")

// ErrDecryptFailed is returned when AEAD decryption fails under both
// current and next keys. We do NOT distinguish "wrong key" from "tampered
// ciphertext" — both are attacker-equivalent outcomes.
var ErrDecryptFailed = errors.New("crypto: decrypt failed")

// ServerAEAD encrypts/decrypts server-side secrets with AES-256-GCM.
// Output is the versioned blob format (alg_id=AES256GCM) from PRD §9.9.
type ServerAEAD struct {
	current cipher.AEAD
	next    cipher.AEAD // optional, used only on decrypt during rotation
}

// NewServerAEAD builds the adapter from one or two base64-encoded 32-byte
// keys. `current` is REQUIRED; `next` is optional and enables dual-key
// rotation (decrypt-with-either, re-encrypt-with-new, retire-old — H5).
func NewServerAEAD(currentB64, nextB64 string) (*ServerAEAD, error) {
	curr, err := buildAEAD(currentB64)
	if err != nil {
		return nil, fmt.Errorf("current: %w", err)
	}
	out := &ServerAEAD{current: curr}
	if nextB64 != "" {
		nxt, err := buildAEAD(nextB64)
		if err != nil {
			return nil, fmt.Errorf("next: %w", err)
		}
		out.next = nxt
	}
	return out, nil
}

// Encrypt produces a versioned AES-256-GCM blob for plaintext. `aad` is
// additional-authenticated-data bound to the ciphertext — callers pass a
// stable domain tag (e.g. the user ID + field name) so an attacker cannot
// cut-and-paste ciphertexts between rows.
func (a *ServerAEAD) Encrypt(plaintext, aad []byte) (domaincrypto.EncryptedBlob, error) {
	nonce := make([]byte, a.current.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return domaincrypto.EncryptedBlob{}, fmt.Errorf("crypto: read nonce: %w", err)
	}
	// Seal layout: ciphertext || tag  (Go's GCM appends tag to ciphertext).
	sealed := a.current.Seal(nil, nonce, plaintext, aad)
	ctLen := len(sealed) - a.current.Overhead()
	return domaincrypto.EncryptedBlob{
		Version:    domaincrypto.V1,
		Alg:        domaincrypto.AlgAES256GCM,
		Nonce:      nonce,
		Ciphertext: sealed[:ctLen],
		Tag:        sealed[ctLen:],
	}, nil
}

// Decrypt reverses Encrypt. If the blob cannot be opened with `current` and
// `next` is set, tries `next` (rotation grace window).
func (a *ServerAEAD) Decrypt(blob domaincrypto.EncryptedBlob, aad []byte) ([]byte, error) {
	if err := blob.Validate(); err != nil {
		return nil, err
	}
	if blob.Alg != domaincrypto.AlgAES256GCM {
		return nil, fmt.Errorf("%w: expected AES-256-GCM, got %s", ErrDecryptFailed, blob.Alg)
	}
	sealed := make([]byte, 0, len(blob.Ciphertext)+len(blob.Tag))
	sealed = append(sealed, blob.Ciphertext...)
	sealed = append(sealed, blob.Tag...)

	if pt, err := a.current.Open(nil, blob.Nonce, sealed, aad); err == nil {
		return pt, nil
	}
	if a.next != nil {
		if pt, err := a.next.Open(nil, blob.Nonce, sealed, aad); err == nil {
			return pt, nil
		}
	}
	return nil, ErrDecryptFailed
}

// ===========================================================================
// helpers
// ===========================================================================

func buildAEAD(b64 string) (cipher.AEAD, error) {
	key, err := decodeKey(b64)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBadDataKey, err)
	}
	return cipher.NewGCM(block)
}

func decodeKey(b64 string) ([]byte, error) {
	// Accept both standard and URL encodings, with or without padding.
	for _, enc := range []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	} {
		if key, err := enc.DecodeString(b64); err == nil && len(key) == 32 {
			return key, nil
		}
	}
	return nil, ErrBadDataKey
}
