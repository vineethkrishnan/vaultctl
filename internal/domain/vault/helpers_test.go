// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"bytes"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

func gcmBlob(tb testing.TB) crypto.EncryptedBlob {
	tb.Helper()
	return crypto.EncryptedBlob{
		Version:    crypto.V1,
		Alg:        crypto.AlgAES256GCM,
		Nonce:      bytes.Repeat([]byte{0xA1}, 12),
		Ciphertext: []byte("x"),
		Tag:        bytes.Repeat([]byte{0xB2}, 16),
	}
}

func rsaBlob(tb testing.TB) crypto.EncryptedBlob {
	tb.Helper()
	return crypto.EncryptedBlob{
		Version:    crypto.V1,
		Alg:        crypto.AlgRSAOAEPSHA256,
		Ciphertext: bytes.Repeat([]byte{0x11}, 256),
	}
}

func kwBlob(tb testing.TB) crypto.EncryptedBlob {
	tb.Helper()
	return crypto.EncryptedBlob{
		Version:    crypto.V1,
		Alg:        crypto.AlgAES256KW,
		Ciphertext: bytes.Repeat([]byte{0x42}, 32),
		Tag:        bytes.Repeat([]byte{0x01}, 8),
	}
}

func ed25519Sig(tb testing.TB) crypto.Signature {
	tb.Helper()
	s, err := crypto.NewEd25519Signature(bytes.Repeat([]byte{0xEE}, crypto.Ed25519SignatureSize))
	if err != nil {
		tb.Fatalf("sig: %v", err)
	}
	return s
}
