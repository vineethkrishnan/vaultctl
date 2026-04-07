package crypto

import (
	"errors"
	"fmt"
)

// EncryptedBlob is the versioned ciphertext envelope described in PRD §9.9.
//
// Wire format (concatenated bytes):
//
//	version (1 byte) || alg_id (1 byte) || nonce (NonceSize bytes) ||
//	ciphertext (variable) || tag (TagSize bytes)
//
// For algorithms that carry no separate tag (e.g. RSA-OAEP), Tag is nil and
// Ciphertext absorbs the tag in the underlying primitive.
type EncryptedBlob struct {
	Version    BlobVersion
	Alg        AlgID
	Nonce      []byte
	Ciphertext []byte
	Tag        []byte
}

// ErrMalformedBlob is returned when parsing a byte slice that is not a
// syntactically valid EncryptedBlob. Wraps domain.ErrInvalid via error chain
// through the caller's use case layer.
var ErrMalformedBlob = errors.New("crypto: malformed encrypted blob")

// MinBlobSize is the smallest possible blob: header + empty ciphertext for
// an algorithm with no nonce and no tag. We refuse empty trailers below this.
const MinBlobSize = 2

// Bytes returns the canonical wire-format encoding. Mutating the returned
// slice does NOT mutate the blob.
func (b EncryptedBlob) Bytes() []byte {
	out := make([]byte, 0, 2+len(b.Nonce)+len(b.Ciphertext)+len(b.Tag))
	out = append(out, byte(b.Version))
	out = append(out, byte(b.Alg))
	out = append(out, b.Nonce...)
	out = append(out, b.Ciphertext...)
	out = append(out, b.Tag...)
	return out
}

// Validate asserts the blob is well-formed for its declared algorithm.
//
// Rules:
//   - Version must equal V1.
//   - Alg must be one of the enumerated IDs.
//   - Nonce length must match the algorithm's NonceSize.
//   - Tag length must match the algorithm's TagSize.
//   - Ciphertext length is algorithm-dependent and not bounded here, but
//     must be non-empty for symmetric algorithms.
func (b EncryptedBlob) Validate() error {
	if b.Version != V1 {
		return fmt.Errorf("%w: unsupported version 0x%02x", ErrMalformedBlob, byte(b.Version))
	}
	if !b.Alg.IsValid() {
		return fmt.Errorf("%w: unknown alg 0x%02x", ErrMalformedBlob, byte(b.Alg))
	}
	if want := b.Alg.NonceSize(); len(b.Nonce) != want {
		return fmt.Errorf("%w: %s nonce len=%d want %d", ErrMalformedBlob, b.Alg, len(b.Nonce), want)
	}
	if want := b.Alg.TagSize(); len(b.Tag) != want {
		return fmt.Errorf("%w: %s tag len=%d want %d", ErrMalformedBlob, b.Alg, len(b.Tag), want)
	}
	if b.Alg == AlgAES256GCM && len(b.Ciphertext) == 0 {
		return fmt.Errorf("%w: empty ciphertext for %s", ErrMalformedBlob, b.Alg)
	}
	return nil
}

// ParseBlob decodes the wire format into an EncryptedBlob and validates it.
// Any out-of-band corruption (short buffer, unknown alg, wrong nonce length)
// results in ErrMalformedBlob.
func ParseBlob(raw []byte) (EncryptedBlob, error) {
	if len(raw) < MinBlobSize {
		return EncryptedBlob{}, fmt.Errorf("%w: input too short (%d bytes)", ErrMalformedBlob, len(raw))
	}

	b := EncryptedBlob{
		Version: BlobVersion(raw[0]),
		Alg:     AlgID(raw[1]),
	}
	if b.Version != V1 {
		return EncryptedBlob{}, fmt.Errorf("%w: unsupported version 0x%02x", ErrMalformedBlob, byte(b.Version))
	}
	if !b.Alg.IsValid() {
		return EncryptedBlob{}, fmt.Errorf("%w: unknown alg 0x%02x", ErrMalformedBlob, byte(b.Alg))
	}

	body := raw[2:]
	nonceLen := b.Alg.NonceSize()
	tagLen := b.Alg.TagSize()
	if len(body) < nonceLen+tagLen {
		return EncryptedBlob{}, fmt.Errorf("%w: body too short for %s (len=%d)", ErrMalformedBlob, b.Alg, len(body))
	}

	// Layout: nonce || ciphertext || tag (tag is the suffix).
	if nonceLen > 0 {
		b.Nonce = append([]byte(nil), body[:nonceLen]...)
		body = body[nonceLen:]
	}
	ctLen := len(body) - tagLen
	b.Ciphertext = append([]byte(nil), body[:ctLen]...)
	if tagLen > 0 {
		b.Tag = append([]byte(nil), body[ctLen:]...)
	}

	if err := b.Validate(); err != nil {
		return EncryptedBlob{}, err
	}
	return b, nil
}
