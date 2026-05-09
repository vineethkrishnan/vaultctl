// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// Folder is a per-vault grouping of items. Its name is encrypted with the
// vault's symmetric key and padded per M5.
type Folder struct {
	ID            FolderID
	VaultID       ID
	EncryptedName crypto.EncryptedBlob
	CreatedAt     time.Time
}

// Validate asserts Folder invariants.
func (f Folder) Validate() error {
	if f.ID == "" {
		return domain.NewInvalid("id", "required")
	}
	if f.VaultID.IsZero() {
		return domain.NewInvalid("vault_id", "required")
	}
	if err := f.EncryptedName.Validate(); err != nil {
		return domain.NewInvalid("encrypted_name", err.Error())
	}
	if f.EncryptedName.Alg != crypto.AlgAES256GCM {
		return domain.NewInvalid("encrypted_name", "folders must use AES-256-GCM")
	}
	return nil
}
