// SPDX-License-Identifier: AGPL-3.0-or-later

package ports

import (
	"context"

	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// AttachmentRepository persists attachment metadata rows. Like ItemRepository,
// every lookup is scoped by BOTH vaultID and itemID so a cross-vault or
// cross-item ID substitution returns ErrNotFound (the H11 IDOR guard). The
// ciphertext bytes live in a BlobStore, not here.
type AttachmentRepository interface {
	Create(ctx context.Context, a vault.Attachment) error

	// Get loads an attachment IFF it belongs to itemID within vaultID.
	Get(ctx context.Context, vaultID vault.ID, itemID vault.ItemID, id vault.AttachmentID) (vault.Attachment, error)

	// ListForItem returns all attachments for an item in a vault.
	ListForItem(ctx context.Context, vaultID vault.ID, itemID vault.ItemID) ([]vault.Attachment, error)

	// Delete removes the metadata row (scoped by vault + item).
	Delete(ctx context.Context, vaultID vault.ID, itemID vault.ItemID, id vault.AttachmentID) error

	// TotalSizeForVault sums ciphertext_size across a vault, for quota checks.
	TotalSizeForVault(ctx context.Context, vaultID vault.ID) (int64, error)

	// StorageKeysForItem returns the blob-store keys of every attachment on
	// an item, so the bytes can be deleted before the rows cascade away.
	StorageKeysForItem(ctx context.Context, vaultID vault.ID, itemID vault.ItemID) ([]string, error)
}
