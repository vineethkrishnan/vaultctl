// SPDX-License-Identifier: AGPL-3.0-or-later

package crypto

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"testing"

	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

func randKeyB64(t *testing.T) string {
	t.Helper()
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return base64.StdEncoding.EncodeToString(buf)
}

func TestServerAEAD_RoundTrip(t *testing.T) {
	t.Parallel()
	aead, err := NewServerAEAD(randKeyB64(t), "")
	if err != nil {
		t.Fatalf("NewServerAEAD: %v", err)
	}
	plaintext := []byte("TOTP secret yyyyyyyyyyyy")
	aad := []byte("user:u1:totp_secret")
	blob, err := aead.Encrypt(plaintext, aad)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if blob.Alg != domaincrypto.AlgAES256GCM {
		t.Fatalf("wrong alg: %v", blob.Alg)
	}
	if err := blob.Validate(); err != nil {
		t.Fatalf("blob invalid: %v", err)
	}

	recovered, err := aead.Decrypt(blob, aad)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if !bytes.Equal(recovered, plaintext) {
		t.Fatalf("plaintext mismatch")
	}
}

func TestServerAEAD_NonceRandomised(t *testing.T) {
	// H9 test: two encryptions of the same plaintext must yield distinct
	// ciphertexts.
	t.Parallel()
	aead, _ := NewServerAEAD(randKeyB64(t), "")
	a, _ := aead.Encrypt([]byte("abc"), nil)
	b, _ := aead.Encrypt([]byte("abc"), nil)
	if bytes.Equal(a.Nonce, b.Nonce) || bytes.Equal(a.Ciphertext, b.Ciphertext) {
		t.Fatalf("random-nonce invariant broken (H9)")
	}
}

func TestServerAEAD_AADBinding(t *testing.T) {
	// Attacker cut-and-paste: ciphertext encrypted with AAD `a` must not
	// open under AAD `b`.
	t.Parallel()
	aead, _ := NewServerAEAD(randKeyB64(t), "")
	blob, _ := aead.Encrypt([]byte("secret"), []byte("ctx-a"))
	if _, err := aead.Decrypt(blob, []byte("ctx-b")); !errors.Is(err, ErrDecryptFailed) {
		t.Fatalf("AAD mismatch: expected ErrDecryptFailed, got %v", err)
	}
}

func TestServerAEAD_TamperDetected(t *testing.T) {
	t.Parallel()
	aead, _ := NewServerAEAD(randKeyB64(t), "")
	blob, _ := aead.Encrypt([]byte("secret payload"), nil)

	// Flip one byte in the ciphertext - tag must catch it.
	if len(blob.Ciphertext) == 0 {
		t.Fatalf("no ciphertext to tamper")
	}
	tampered := blob
	tampered.Ciphertext = append([]byte(nil), blob.Ciphertext...)
	tampered.Ciphertext[0] ^= 0xFF

	if _, err := aead.Decrypt(tampered, nil); !errors.Is(err, ErrDecryptFailed) {
		t.Fatalf("tamper: expected ErrDecryptFailed, got %v", err)
	}
}

func TestServerAEAD_DualKeyRotation(t *testing.T) {
	t.Parallel()
	keyOld := randKeyB64(t)
	keyNew := randKeyB64(t)

	// "Before rotation": service has ONLY the old key.
	preAEAD, _ := NewServerAEAD(keyOld, "")
	blob, _ := preAEAD.Encrypt([]byte("rotate me"), []byte("aad"))

	// "During rotation": current=new, next=old (grace window).
	postAEAD, err := NewServerAEAD(keyNew, keyOld)
	if err != nil {
		t.Fatalf("NewServerAEAD rotated: %v", err)
	}
	// The old-key ciphertext must decrypt under the rotated service.
	pt, err := postAEAD.Decrypt(blob, []byte("aad"))
	if err != nil {
		t.Fatalf("rotation decrypt: %v", err)
	}
	if string(pt) != "rotate me" {
		t.Fatalf("rotation plaintext wrong: %q", pt)
	}

	// And NEW encryptions use the NEW key - the old-only service cannot
	// open them.
	newBlob, _ := postAEAD.Encrypt([]byte("new"), []byte("aad"))
	if _, err := preAEAD.Decrypt(newBlob, []byte("aad")); !errors.Is(err, ErrDecryptFailed) {
		t.Fatalf("post-rotation blob should not decrypt under old-only service")
	}
}

func TestNewServerAEAD_KeyValidation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, current, next string
	}{
		{"empty current", "", ""},
		{"garbage current", "!!!not-base64!!!", ""},
		{"wrong len", base64.StdEncoding.EncodeToString([]byte("tooshort")), ""},
		{"garbage next", randKeyB64(t), "!!!not-base64!!!"},
	}
	for _, tc := range cases {
		if _, err := NewServerAEAD(tc.current, tc.next); err == nil {
			t.Fatalf("%s: expected error", tc.name)
		}
	}
}

func TestServerAEAD_RejectsNonGCMBlob(t *testing.T) {
	t.Parallel()
	aead, _ := NewServerAEAD(randKeyB64(t), "")
	rsaBlob := domaincrypto.EncryptedBlob{
		Version:    domaincrypto.V1,
		Alg:        domaincrypto.AlgRSAOAEPSHA256,
		Ciphertext: bytes.Repeat([]byte{1}, 256),
	}
	if _, err := aead.Decrypt(rsaBlob, nil); !errors.Is(err, ErrDecryptFailed) {
		t.Fatalf("expected ErrDecryptFailed for non-GCM blob")
	}

	badBlob := domaincrypto.EncryptedBlob{Version: domaincrypto.BlobVersion(0x09), Alg: domaincrypto.AlgAES256GCM}
	if _, err := aead.Decrypt(badBlob, nil); err == nil {
		t.Fatalf("expected error for malformed blob")
	}
}
