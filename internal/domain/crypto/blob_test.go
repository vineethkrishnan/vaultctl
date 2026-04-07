package crypto

import (
	"bytes"
	"errors"
	"testing"
)

func gcmBlob(ct []byte) EncryptedBlob {
	return EncryptedBlob{
		Version:    V1,
		Alg:        AlgAES256GCM,
		Nonce:      bytes.Repeat([]byte{0xAA}, 12),
		Ciphertext: ct,
		Tag:        bytes.Repeat([]byte{0xBB}, 16),
	}
}

func TestEncryptedBlob_RoundTrip(t *testing.T) {
	t.Parallel()
	in := gcmBlob([]byte("hello"))
	raw := in.Bytes()

	// Canonical wire layout check
	if raw[0] != byte(V1) || raw[1] != byte(AlgAES256GCM) {
		t.Fatalf("bad header prefix: %x %x", raw[0], raw[1])
	}
	wantLen := 2 + 12 + len("hello") + 16
	if len(raw) != wantLen {
		t.Fatalf("wire length = %d, want %d", len(raw), wantLen)
	}

	out, err := ParseBlob(raw)
	if err != nil {
		t.Fatalf("ParseBlob: %v", err)
	}
	if out.Version != in.Version || out.Alg != in.Alg {
		t.Fatalf("header mismatch: %v", out)
	}
	if !bytes.Equal(out.Nonce, in.Nonce) || !bytes.Equal(out.Ciphertext, in.Ciphertext) || !bytes.Equal(out.Tag, in.Tag) {
		t.Fatalf("body mismatch")
	}
}

func TestParseBlob_RSAOAEP_NoNonceNoTag(t *testing.T) {
	t.Parallel()
	in := EncryptedBlob{Version: V1, Alg: AlgRSAOAEPSHA256, Ciphertext: []byte("wrapped-key")}
	out, err := ParseBlob(in.Bytes())
	if err != nil {
		t.Fatalf("ParseBlob: %v", err)
	}
	if len(out.Nonce) != 0 || len(out.Tag) != 0 {
		t.Fatalf("RSA blob should have no nonce/tag")
	}
	if !bytes.Equal(out.Ciphertext, in.Ciphertext) {
		t.Fatalf("ciphertext mismatch")
	}
}

func TestParseBlob_AESKW_HasTagNoNonce(t *testing.T) {
	t.Parallel()
	in := EncryptedBlob{
		Version:    V1,
		Alg:        AlgAES256KW,
		Ciphertext: bytes.Repeat([]byte{0x42}, 32),
		Tag:        bytes.Repeat([]byte{0x01}, 8),
	}
	out, err := ParseBlob(in.Bytes())
	if err != nil {
		t.Fatalf("ParseBlob: %v", err)
	}
	if len(out.Nonce) != 0 {
		t.Fatalf("AES-KW nonce must be empty")
	}
	if len(out.Tag) != 8 {
		t.Fatalf("tag len = %d, want 8", len(out.Tag))
	}
}

func TestParseBlob_Rejects(t *testing.T) {
	t.Parallel()

	// Short inputs
	cases := []struct {
		name string
		in   []byte
	}{
		{"empty", []byte{}},
		{"1 byte", []byte{0x01}},
		{"bad version", []byte{0x02, byte(AlgAES256GCM)}},
		{"unknown alg", []byte{byte(V1), 0x99}},
		{"short body for GCM", append([]byte{byte(V1), byte(AlgAES256GCM)}, bytes.Repeat([]byte{0}, 5)...)},
	}
	for _, tc := range cases {
		_, err := ParseBlob(tc.in)
		if err == nil {
			t.Fatalf("%s: expected error", tc.name)
		}
		if !errors.Is(err, ErrMalformedBlob) {
			t.Fatalf("%s: errors.Is(err, ErrMalformedBlob) = false (err=%v)", tc.name, err)
		}
	}
}

func TestEncryptedBlob_Validate_CatchesMismatches(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		blob EncryptedBlob
	}{
		{"gcm wrong nonce", EncryptedBlob{Version: V1, Alg: AlgAES256GCM, Nonce: []byte{1, 2, 3}, Ciphertext: []byte{0}, Tag: bytes.Repeat([]byte{0}, 16)}},
		{"gcm wrong tag", EncryptedBlob{Version: V1, Alg: AlgAES256GCM, Nonce: bytes.Repeat([]byte{0}, 12), Ciphertext: []byte{0}, Tag: []byte{0}}},
		{"gcm empty ct", EncryptedBlob{Version: V1, Alg: AlgAES256GCM, Nonce: bytes.Repeat([]byte{0}, 12), Ciphertext: nil, Tag: bytes.Repeat([]byte{0}, 16)}},
		{"bad version", EncryptedBlob{Version: BlobVersion(0x07), Alg: AlgRSAOAEPSHA256, Ciphertext: []byte{1}}},
		{"kw bad tag", EncryptedBlob{Version: V1, Alg: AlgAES256KW, Ciphertext: []byte{1}, Tag: []byte{1, 2, 3}}},
	}
	for _, tc := range cases {
		if err := tc.blob.Validate(); err == nil {
			t.Fatalf("%s: expected Validate() error", tc.name)
		}
	}
}

func TestEncryptedBlob_Validate_DirectVersionMismatch(t *testing.T) {
	// ParseBlob rejects bad versions before calling Validate, so the bad-
	// version branch in Validate needs a direct-construction test.
	t.Parallel()
	b := gcmBlob([]byte("x"))
	b.Version = BlobVersion(0x05)
	if err := b.Validate(); err == nil {
		t.Fatalf("expected version-mismatch error from Validate()")
	}
}

func TestEncryptedBlob_Validate_DirectAlgMismatch(t *testing.T) {
	t.Parallel()
	b := gcmBlob([]byte("x"))
	b.Alg = AlgID(0xF0)
	if err := b.Validate(); err == nil {
		t.Fatalf("expected alg-mismatch error from Validate()")
	}
}

func TestParseBlob_BareHeader_RSA(t *testing.T) {
	// RSA blob has no nonce + no tag; a bare header (no ciphertext) is a
	// valid wire shape but Validate() should still accept it — ciphertext
	// length is not bounded for RSA.
	t.Parallel()
	raw := []byte{byte(V1), byte(AlgRSAOAEPSHA256)}
	b, err := ParseBlob(raw)
	if err != nil {
		t.Fatalf("bare RSA header should parse: %v", err)
	}
	if len(b.Nonce) != 0 || len(b.Tag) != 0 || len(b.Ciphertext) != 0 {
		t.Fatalf("bare RSA blob: unexpected body")
	}
}

func TestEncryptedBlob_Bytes_Immutable(t *testing.T) {
	t.Parallel()
	b := gcmBlob([]byte("abc"))
	raw1 := b.Bytes()
	raw1[0] = 0xFF // mutate caller's copy
	raw2 := b.Bytes()
	if raw2[0] != byte(V1) {
		t.Fatalf("Bytes() returned a shared slice — mutation leaked")
	}
}
