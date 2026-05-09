// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"context"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// CreateFolderInput creates a new folder within a vault. EncryptedName
// must carry a v1|AES-256-GCM header (PRD §9.9).
type CreateFolderInput struct {
	Caller        user.ID
	VaultID       domainvault.ID
	EncryptedName crypto.EncryptedBlob
}

// CreateFolder is the folder-creation use case.
type CreateFolder struct {
	Vaults  ports.VaultRepository
	Folders ports.FolderRepository
	Clock   ports.Clock
	IDs     ports.IDGenerator
}

// Execute runs the use case.
func (uc *CreateFolder) Execute(ctx context.Context, in CreateFolderInput) (domainvault.Folder, error) {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return domainvault.Folder{}, err
	}
	f := domainvault.Folder{
		ID:            domainvault.FolderID(uc.IDs.NewID()),
		VaultID:       in.VaultID,
		EncryptedName: in.EncryptedName,
		CreatedAt:     uc.Clock.Now(),
	}
	if err := f.Validate(); err != nil {
		return domainvault.Folder{}, err
	}
	if err := uc.Folders.Create(ctx, f); err != nil {
		return domainvault.Folder{}, fmt.Errorf("persist folder: %w", err)
	}
	return f, nil
}

// RenameFolderInput mutates a folder's encrypted name.
type RenameFolderInput struct {
	Caller        user.ID
	VaultID       domainvault.ID
	FolderID      domainvault.FolderID
	EncryptedName crypto.EncryptedBlob
}

// RenameFolder updates a folder's encrypted name.
type RenameFolder struct {
	Vaults  ports.VaultRepository
	Folders ports.FolderRepository
}

// Execute runs the use case.
func (uc *RenameFolder) Execute(ctx context.Context, in RenameFolderInput) (domainvault.Folder, error) {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return domainvault.Folder{}, err
	}
	f, err := uc.Folders.Get(ctx, in.VaultID, in.FolderID)
	if err != nil {
		return domainvault.Folder{}, err
	}
	// Defence-in-depth: folder must belong to the URL vault (mirrors H11).
	if f.VaultID != in.VaultID {
		return domainvault.Folder{}, domain.ErrNotFound
	}
	f.EncryptedName = in.EncryptedName
	if err := f.Validate(); err != nil {
		return domainvault.Folder{}, err
	}
	if err := uc.Folders.Update(ctx, f); err != nil {
		return domainvault.Folder{}, fmt.Errorf("persist rename: %w", err)
	}
	return f, nil
}

// DeleteFolderInput removes a folder. Items previously assigned to it
// return to root (PRD §9.3 ON DELETE SET NULL).
type DeleteFolderInput struct {
	Caller   user.ID
	VaultID  domainvault.ID
	FolderID domainvault.FolderID
}

// DeleteFolder drops a folder (items are preserved).
type DeleteFolder struct {
	Vaults  ports.VaultRepository
	Folders ports.FolderRepository
}

// Execute runs the use case.
func (uc *DeleteFolder) Execute(ctx context.Context, in DeleteFolderInput) error {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return err
	}
	f, err := uc.Folders.Get(ctx, in.VaultID, in.FolderID)
	if err != nil {
		return err
	}
	if f.VaultID != in.VaultID {
		return domain.ErrNotFound
	}
	return uc.Folders.Delete(ctx, in.VaultID, in.FolderID)
}

// ListFoldersInput lists folders in a vault.
type ListFoldersInput struct {
	Caller  user.ID
	VaultID domainvault.ID
}

// ListFolders returns all folders in a vault.
type ListFolders struct {
	Vaults  ports.VaultRepository
	Folders ports.FolderRepository
}

// Execute runs the use case.
func (uc *ListFolders) Execute(ctx context.Context, in ListFoldersInput) ([]domainvault.Folder, error) {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return nil, err
	}
	return uc.Folders.List(ctx, in.VaultID)
}
