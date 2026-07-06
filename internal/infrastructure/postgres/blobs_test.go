// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"bytes"
	"unicode/utf8"

	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// gcmBlob builds a realistic v1 AES-256-GCM blob whose wire bytes contain a
// non-UTF-8 byte (0xa3), mirroring the ciphertext that broke the password
// reset/change writes.
func gcmBlob() crypto.EncryptedBlob {
	return crypto.EncryptedBlob{
		Version:    crypto.V1,
		Alg:        crypto.AlgAES256GCM,
		Nonce:      bytes.Repeat([]byte{0xa3}, 12),
		Ciphertext: []byte{0xa3, 0x00, 0xff, 0x1b, 0xa3},
		Tag:        bytes.Repeat([]byte{0x7f}, 16),
	}
}

// TestEncodeBlobBytesRoundTrip guards the repo boundary invariant that broke:
// the raw ciphertext bytes written by UpdatePasswordMaterial(AndHint) must be
// encoded so the read path's decodeBlob recovers the exact same blob.
func TestEncodeBlobBytesRoundTrip(t *testing.T) {
	original := gcmBlob()
	raw := original.Bytes()

	if utf8.Valid(raw) {
		t.Fatalf("test fixture should contain non-UTF-8 bytes to exercise the 22021 case")
	}

	stored := encodeBlobBytes(raw)
	if !utf8.ValidString(stored) {
		t.Fatalf("encodeBlobBytes must produce UTF-8-safe TEXT for the encrypted_private_key column")
	}

	got, err := decodeBlob(stored)
	if err != nil {
		t.Fatalf("decodeBlob after encodeBlobBytes: %v", err)
	}
	if !bytes.Equal(got.Bytes(), raw) {
		t.Fatalf("round trip mismatch:\n want %x\n  got %x", raw, got.Bytes())
	}
}

// TestEncodeBlobBytesMatchesEncodeBlob asserts the update-path encoder agrees
// byte-for-byte with the Create-path encoder, so a row written by an update is
// indistinguishable from one written at registration.
func TestEncodeBlobBytesMatchesEncodeBlob(t *testing.T) {
	blob := gcmBlob()

	fromCreate := encodeBlob(blob)
	fromUpdate := encodeBlobBytes(blob.Bytes())

	if fromCreate != fromUpdate {
		t.Fatalf("encoders disagree:\n create %q\n update %q", fromCreate, fromUpdate)
	}
}

func TestEncodeBlobBytesEmpty(t *testing.T) {
	if got := encodeBlobBytes(nil); got != "" {
		t.Fatalf("nil input: want empty string, got %q", got)
	}
	if got := encodeBlobBytes([]byte{}); got != "" {
		t.Fatalf("empty input: want empty string, got %q", got)
	}
}
