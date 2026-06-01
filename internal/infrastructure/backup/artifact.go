// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"fmt"
	"time"

	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// Sealer seals/opens artifact bytes with the server data key. ServerAEAD
// satisfies it; kept as an interface so the packaging logic stays testable.
type Sealer interface {
	Encrypt(plaintext, aad []byte) (domaincrypto.EncryptedBlob, error)
	Decrypt(blob domaincrypto.EncryptedBlob, aad []byte) ([]byte, error)
}

// artifactAAD binds a sealed artifact to its destination so a blob cannot be
// replayed against a different destination.
func artifactAAD(destinationID string) []byte {
	return []byte("backup:artifact:" + destinationID)
}

// Seal wraps the (already client-encrypted) export bytes with the server data
// key and returns the wire-format blob to store.
func Seal(sealer Sealer, destinationID string, plaintext []byte) ([]byte, error) {
	blob, err := sealer.Encrypt(plaintext, artifactAAD(destinationID))
	if err != nil {
		return nil, fmt.Errorf("backup: seal artifact: %w", err)
	}
	return blob.Bytes(), nil
}

// Open reverses Seal, returning the client-encrypted export bytes. The result
// is still useless without the user's master password.
func Open(sealer Sealer, destinationID string, raw []byte) ([]byte, error) {
	blob, err := domaincrypto.ParseBlob(raw)
	if err != nil {
		return nil, fmt.Errorf("backup: parse artifact: %w", err)
	}
	plaintext, err := sealer.Decrypt(blob, artifactAAD(destinationID))
	if err != nil {
		return nil, fmt.Errorf("backup: open artifact: %w", err)
	}
	return plaintext, nil
}

// ArtifactName returns a sorted, filesystem-safe name for a backup taken at t.
func ArtifactName(t time.Time) string {
	return fmt.Sprintf("vaultctl-export-%s.vctlbak", t.UTC().Format("20060102-150405"))
}
