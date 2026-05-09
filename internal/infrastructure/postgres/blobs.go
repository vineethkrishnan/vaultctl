// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"encoding/base64"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// encodeBlob serializes a domain EncryptedBlob to the base64-TEXT
// representation stored in the DB. Empty blobs return "".
func encodeBlob(b crypto.EncryptedBlob) string {
	if b.Version == 0 {
		return ""
	}
	return base64.StdEncoding.EncodeToString(b.Bytes())
}

// decodeBlob parses the base64-TEXT back into a domain EncryptedBlob.
// Empty inputs yield zero-value blobs.
func decodeBlob(s string) (crypto.EncryptedBlob, error) {
	if s == "" {
		return crypto.EncryptedBlob{}, nil
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return crypto.EncryptedBlob{}, fmt.Errorf("decode blob: %w", err)
	}
	return crypto.ParseBlob(raw)
}

// encodeSig b64-encodes an Ed25519 signature.
func encodeSig(s crypto.Signature) string {
	if s.IsZero() {
		return ""
	}
	return base64.StdEncoding.EncodeToString(s.Bytes())
}

func decodeSig(s string) (crypto.Signature, error) {
	if s == "" {
		return crypto.Signature{}, nil
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return crypto.Signature{}, fmt.Errorf("decode sig: %w", err)
	}
	return crypto.NewEd25519Signature(raw)
}

func encodePublicKey(k crypto.PublicKey) string {
	if k.IsZero() {
		return ""
	}
	return base64.StdEncoding.EncodeToString(k.Bytes())
}

func decodePublicKey(s string) (crypto.PublicKey, error) {
	if s == "" {
		return crypto.PublicKey{}, nil
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return crypto.PublicKey{}, fmt.Errorf("decode pubkey: %w", err)
	}
	return crypto.NewPublicKey(raw)
}
