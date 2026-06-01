// SPDX-License-Identifier: AGPL-3.0-or-later

// Package backup holds the use cases for per-user scheduled backups. The
// artifact a destination stores is the user's client-encrypted export
// (ciphertext only), sealed again here with the server data key before it
// leaves the box, so a destination never holds plaintext or keys.
package backup

import (
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// artifactAAD binds a sealed artifact to its destination so a blob cannot be
// replayed against a different destination.
func artifactAAD(destinationID string) []byte {
	return []byte("backup:artifact:" + destinationID)
}

// sealArtifact wraps the (already client-encrypted) export bytes with the
// server data key and returns the wire-format blob to store.
func sealArtifact(sealer ports.Sealer, destinationID string, plaintext []byte) ([]byte, error) {
	blob, err := sealer.Encrypt(plaintext, artifactAAD(destinationID))
	if err != nil {
		return nil, fmt.Errorf("backup: seal artifact: %w", err)
	}
	return blob.Bytes(), nil
}

// openArtifact reverses sealArtifact, returning the client-encrypted export
// bytes. The result is still useless without the user's master password.
func openArtifact(sealer ports.Sealer, destinationID string, raw []byte) ([]byte, error) {
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

// artifactName returns a sorted, filesystem-safe name for a backup taken at t.
func artifactName(t time.Time) string {
	return fmt.Sprintf("vaultctl-export-%s.vctlbak", t.UTC().Format("20060102-150405"))
}
