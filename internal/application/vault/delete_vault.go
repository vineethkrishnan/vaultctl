// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// DeleteVaultInput identifies the vault to delete and the caller.
type DeleteVaultInput struct {
	Caller  user.ID
	VaultID domainvault.ID
}

// attachmentKeyLister is the slice of AttachmentRepository this use case
// needs; *postgres.AttachmentRepo satisfies it.
type attachmentKeyLister interface {
	StorageKeysForVault(ctx context.Context, vaultID domainvault.ID) ([]string, error)
}

// blobDeleter is the slice of BlobStore this use case needs.
type blobDeleter interface {
	Delete(ctx context.Context, key string) error
}

// DeleteVault permanently deletes a vault with everything in it. There is no
// vault-level trash: the handler layer additionally gates this behind a
// step-up (fresh master-password verification) because the action is
// irreversible.
type DeleteVault struct {
	Vaults ports.VaultRepository
	// Attachments + Blobs are nil when the blob store is unavailable; blob
	// cleanup is then skipped (the metadata rows still cascade away).
	Attachments attachmentKeyLister
	Blobs       blobDeleter
}

// Execute deletes the vault after asserting the caller owns it and that it is
// not their last remaining vault (an account with zero vaults breaks every
// client's assumptions). Attachment blobs are deleted best-effort after the
// row delete commits - an orphaned blob is unreadable ciphertext, never a
// resurrected vault.
func (uc *DeleteVault) Execute(ctx context.Context, in DeleteVaultInput) error {
	role, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID)
	if err != nil {
		return err
	}
	if role != user.RoleOwner {
		return fmt.Errorf("%w: only the owner can delete a vault", ErrInsufficientRole)
	}

	memberships, err := uc.Vaults.ListForUser(ctx, in.Caller)
	if err != nil {
		return fmt.Errorf("list caller vaults: %w", err)
	}
	if len(memberships) <= 1 {
		return domain.NewInvalid("vault_id", "cannot delete your last remaining vault")
	}

	var blobKeys []string
	if uc.Attachments != nil && uc.Blobs != nil {
		blobKeys, err = uc.Attachments.StorageKeysForVault(ctx, in.VaultID)
		if err != nil {
			return fmt.Errorf("list attachment blobs: %w", err)
		}
	}

	if err := uc.Vaults.Delete(ctx, in.VaultID); err != nil {
		return fmt.Errorf("delete vault: %w", err)
	}

	for _, key := range blobKeys {
		if derr := uc.Blobs.Delete(ctx, key); derr != nil {
			slog.WarnContext(ctx, "vault.delete.blob_cleanup_failed",
				slog.String("vault_id", string(in.VaultID)),
				slog.String("err", derr.Error()))
		}
	}
	return nil
}
