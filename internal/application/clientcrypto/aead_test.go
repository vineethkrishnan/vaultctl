package clientcrypto_test

import (
	"bytes"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/application/clientcrypto"
	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

func TestEncryptDecrypt_RoundTrip(t *testing.T) {
	key := bytes.Repeat([]byte{0x42}, 32)
	plaintext := []byte("zero knowledge hello")

	blob, err := clientcrypto.Encrypt(key, plaintext, nil)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if blob.Alg != domaincrypto.AlgAES256GCM {
		t.Errorf("alg = %s, want AES-256-GCM", blob.Alg)
	}
	if err := blob.Validate(); err != nil {
		t.Fatalf("blob.Validate: %v", err)
	}

	got, err := clientcrypto.Decrypt(key, blob, nil)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Errorf("round trip: got %q want %q", got, plaintext)
	}
}

func TestEncrypt_WireFormatParses(t *testing.T) {
	key := bytes.Repeat([]byte{0x11}, 32)
	blob, err := clientcrypto.Encrypt(key, []byte("wire"), []byte("aad"))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	raw := blob.Bytes()
	parsed, err := domaincrypto.ParseBlob(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	got, err := clientcrypto.Decrypt(key, parsed, []byte("aad"))
	if err != nil {
		t.Fatalf("decrypt parsed: %v", err)
	}
	if string(got) != "wire" {
		t.Errorf("plaintext mismatch: %q", got)
	}
}

func TestDecrypt_WrongKeyFails(t *testing.T) {
	key := bytes.Repeat([]byte{0x01}, 32)
	otherKey := bytes.Repeat([]byte{0x02}, 32)

	blob, err := clientcrypto.Encrypt(key, []byte("secret"), nil)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if _, err := clientcrypto.Decrypt(otherKey, blob, nil); err == nil {
		t.Errorf("decrypt with wrong key should fail")
	}
}

func TestDecrypt_AADMismatch(t *testing.T) {
	key := bytes.Repeat([]byte{0x33}, 32)
	blob, err := clientcrypto.Encrypt(key, []byte("data"), []byte("ctx1"))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if _, err := clientcrypto.Decrypt(key, blob, []byte("ctx2")); err == nil {
		t.Errorf("AAD mismatch should fail")
	}
}

func TestEncrypt_KeySizeRejected(t *testing.T) {
	if _, err := clientcrypto.Encrypt(make([]byte, 16), []byte("x"), nil); err == nil {
		t.Errorf("expected 16-byte key to be rejected")
	}
}
