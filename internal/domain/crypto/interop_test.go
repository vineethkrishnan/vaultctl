// SPDX-License-Identifier: AGPL-3.0-or-later

package crypto_test

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/hkdf"
	"io"

	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// fixtureDir locates testdata/crypto relative to the repo root.
func fixtureDir(t *testing.T) string {
	t.Helper()
	// Walk up from internal/domain/crypto to repo root.
	dir := filepath.Join("..", "..", "..", "testdata", "crypto")
	if _, err := os.Stat(dir); err != nil {
		t.Skipf("fixture dir not found at %s — run 'cd web && npx vitest run' first", dir)
	}
	return dir
}

func b64Decode(t *testing.T, s string) []byte {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	return data
}

// ==========================================================================
// AES-256-GCM interop: TS encrypts, Go decrypts
// ==========================================================================

type aesGcmFixture struct {
	KeyB64       string  `json:"key_b64"`
	PlaintextB64 string  `json:"plaintext_b64"`
	BlobB64      string  `json:"blob_b64"`
	AADB64       *string `json:"aad_b64,omitempty"`
}

func TestInterop_AESGCMDecrypt(t *testing.T) {
	dir := fixtureDir(t)
	raw, err := os.ReadFile(filepath.Join(dir, "aes_gcm_fixtures.json"))
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}

	var fixtures []aesGcmFixture
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	for i, f := range fixtures {
		key := b64Decode(t, f.KeyB64)
		wantPlaintext := b64Decode(t, f.PlaintextB64)
		blobRaw := b64Decode(t, f.BlobB64)

		var aad []byte
		if f.AADB64 != nil {
			aad = b64Decode(t, *f.AADB64)
		}

		// Parse the blob using domain parser
		blob, err := crypto.ParseBlob(blobRaw)
		if err != nil {
			t.Fatalf("[%d] ParseBlob: %v", i, err)
		}

		if blob.Alg != crypto.AlgAES256GCM {
			t.Fatalf("[%d] expected alg 0x01, got 0x%02x", i, byte(blob.Alg))
		}

		// Decrypt using raw Go crypto (not ServerAEAD, which adds its own key layer)
		block, err := aes.NewCipher(key)
		if err != nil {
			t.Fatalf("[%d] NewCipher: %v", i, err)
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			t.Fatalf("[%d] NewGCM: %v", i, err)
		}

		// Reconstruct sealed = ciphertext || tag
		sealed := make([]byte, 0, len(blob.Ciphertext)+len(blob.Tag))
		sealed = append(sealed, blob.Ciphertext...)
		sealed = append(sealed, blob.Tag...)

		plaintext, err := gcm.Open(nil, blob.Nonce, sealed, aad)
		if err != nil {
			t.Fatalf("[%d] GCM Open: %v", i, err)
		}

		if string(plaintext) != string(wantPlaintext) {
			t.Errorf("[%d] plaintext mismatch: got %q, want %q", i, plaintext, wantPlaintext)
		}
	}
}

// ==========================================================================
// HKDF interop: TS derives, Go verifies derivation
// ==========================================================================

type hkdfFixture struct {
	MasterKeyB64    string `json:"master_key_b64"`
	AuthHashB64     string `json:"auth_hash_b64"`
	StretchedKeyB64 string `json:"stretched_key_b64"`
}

func TestInterop_HKDFDerivation(t *testing.T) {
	dir := fixtureDir(t)
	raw, err := os.ReadFile(filepath.Join(dir, "hkdf_fixtures.json"))
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}

	var fixtures []hkdfFixture
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	for i, f := range fixtures {
		masterKey := b64Decode(t, f.MasterKeyB64)
		wantAuth := b64Decode(t, f.AuthHashB64)
		wantStretched := b64Decode(t, f.StretchedKeyB64)

		// Derive authHash: HKDF-SHA256(masterKey, salt=empty, info="auth")
		authReader := hkdf.New(sha256.New, masterKey, nil, []byte("auth"))
		gotAuth := make([]byte, 32)
		if _, err := io.ReadFull(authReader, gotAuth); err != nil {
			t.Fatalf("[%d] HKDF auth: %v", i, err)
		}

		if string(gotAuth) != string(wantAuth) {
			t.Errorf("[%d] authHash mismatch", i)
		}

		// Derive stretchedKey: HKDF-SHA256(masterKey, salt=empty, info="enc")
		encReader := hkdf.New(sha256.New, masterKey, nil, []byte("enc"))
		gotStretched := make([]byte, 32)
		if _, err := io.ReadFull(encReader, gotStretched); err != nil {
			t.Fatalf("[%d] HKDF enc: %v", i, err)
		}

		if string(gotStretched) != string(wantStretched) {
			t.Errorf("[%d] stretchedKey mismatch", i)
		}
	}
}

// ==========================================================================
// Padding interop: TS pads, Go verifies
// ==========================================================================

type paddingFixture struct {
	OriginalB64 string `json:"original_b64"`
	PaddedB64   string `json:"padded_b64"`
}

func TestInterop_Padding(t *testing.T) {
	dir := fixtureDir(t)
	raw, err := os.ReadFile(filepath.Join(dir, "padding_fixtures.json"))
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}

	var fixtures []paddingFixture
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	for i, f := range fixtures {
		original := b64Decode(t, f.OriginalB64)
		padded := b64Decode(t, f.PaddedB64)

		// Verify padded length is multiple of 32
		if len(padded)%32 != 0 {
			t.Errorf("[%d] padded length %d not multiple of 32", i, len(padded))
		}

		// Verify PKCS#7 unpad
		padLen := int(padded[len(padded)-1])
		if padLen < 1 || padLen > 32 {
			t.Errorf("[%d] invalid pad byte %d", i, padLen)
			continue
		}

		// Check all padding bytes
		for j := len(padded) - padLen; j < len(padded); j++ {
			if padded[j] != byte(padLen) {
				t.Errorf("[%d] inconsistent pad byte at position %d: got %d, want %d", i, j, padded[j], padLen)
			}
		}

		// Unpad and compare to original
		unpadded := padded[:len(padded)-padLen]
		if string(unpadded) != string(original) {
			t.Errorf("[%d] unpadded mismatch: got %q, want %q", i, unpadded, original)
		}
	}
}
