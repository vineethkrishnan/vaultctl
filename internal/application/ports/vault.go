// SPDX-License-Identifier: AGPL-3.0-or-later

package ports

import (
	"context"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// VaultRepository persists Vault + VaultMember rows. IsActiveMember is the
// bedrock authorization primitive - every use case calls it before any item
// or folder operation.
type VaultRepository interface {
	// Create inserts a Vault row plus the creator's initial membership.
	// The initial membership carries the creator's wrapped vault key.
	Create(ctx context.Context, v vault.Vault, creatorMember vault.Member) error

	// Get loads a Vault by ID. Returns ErrNotFound when missing.
	Get(ctx context.Context, id vault.ID) (vault.Vault, error)

	// ListForUser returns every vault (personal + shared) where userID is
	// an ACTIVE member (removed_at IS NULL).
	ListForUser(ctx context.Context, userID user.ID) ([]vault.Vault, error)

	// IsActiveMember reports whether userID has a current (non-removed)
	// membership row for vaultID, and if so, that user's per-vault role.
	//
	// This is the single authorization boundary for item/folder access.
	// M3 finding: membership rows are soft-deleted (removed_at), so the
	// query MUST filter removed_at IS NULL.
	IsActiveMember(ctx context.Context, userID user.ID, vaultID vault.ID) (user.Role, bool, error)

	// AddMember inserts a new vault_members row.
	AddMember(ctx context.Context, m vault.Member) error

	// RemoveMember soft-deletes a membership (sets removed_at). The caller
	// is responsible for triggering the client-driven rekey (C2).
	RemoveMember(ctx context.Context, vaultID vault.ID, userID user.ID) error

	// UpdateMemberRole changes a member's per-vault role.
	UpdateMemberRole(ctx context.Context, vaultID vault.ID, userID user.ID, role user.Role) error

	// ListMembers returns all ACTIVE members of a vault.
	ListMembers(ctx context.Context, vaultID vault.ID) ([]vault.Member, error)

	// MemberForUser returns the caller's membership row for a vault.
	// Returns ErrNotFound if the user is not an active member.
	MemberForUser(ctx context.Context, vaultID vault.ID, userID user.ID) (vault.Member, error)

	// ListSharedByOrgMember returns every shared-vault ID within the given
	// org where userID is still an active member. Used by the org-level
	// member removal flow (C2) to build the cascade rekey list.
	ListSharedByOrgMember(ctx context.Context, orgID organization.ID, userID user.ID) ([]vault.ID, error)
}

// ItemRepository persists vault_items rows.
//
// EVERY method receives BOTH vaultID AND itemID so the infrastructure query
// can assert item.vault_id == :vaultId (the H11 IDOR guard). Callers MUST
// have already confirmed membership via VaultRepository.IsActiveMember.
type ItemRepository interface {
	Create(ctx context.Context, it vault.Item) error

	// Get loads an item IF AND ONLY IF its vault_id matches vaultID (H11).
	// Returns ErrNotFound both for "no such item" and for "item exists but
	// belongs to a different vault" - these cases are indistinguishable to
	// the caller by design.
	Get(ctx context.Context, vaultID vault.ID, itemID vault.ItemID) (vault.Item, error)

	// Update applies the new encrypted blobs + metadata. vault_id binding
	// is enforced by the underlying query (WHERE id = :id AND vault_id = :vaultId).
	Update(ctx context.Context, it vault.Item) error

	// SoftDelete sets deleted_at. The item remains in storage until the
	// trash-purge cron runs or the user explicitly purges.
	SoftDelete(ctx context.Context, vaultID vault.ID, itemID vault.ItemID, at time.Time) error

	// Restore clears deleted_at.
	Restore(ctx context.Context, vaultID vault.ID, itemID vault.ItemID, at time.Time) error

	// HardDelete removes the row. Used for explicit purge + trash cleanup.
	HardDelete(ctx context.Context, vaultID vault.ID, itemID vault.ItemID) error

	// ListActive returns items with deleted_at IS NULL.
	ListActive(ctx context.Context, vaultID vault.ID, opts ItemListOptions) ([]vault.Item, error)

	// ListTrashed returns items with deleted_at IS NOT NULL.
	ListTrashed(ctx context.Context, vaultID vault.ID) ([]vault.Item, error)

	// PurgeExpired removes trashed items older than cutoff, returning the
	// number purged. Called by the trash-retention cron.
	PurgeExpired(ctx context.Context, cutoff time.Time) (int, error)

	// PurgeExpiredInVault removes trashed items older than cutoff within a
	// single vault, returning the number purged. Used by the bulk trash
	// purge API endpoint.
	PurgeExpiredInVault(ctx context.Context, vaultID vault.ID, cutoff time.Time) (int, error)

	// CreateBatch inserts multiple items in a single transaction. Used by
	// the import endpoint.
	CreateBatch(ctx context.Context, items []vault.Item) error
}

// ItemListOptions filters the active-items list. Only server-visible fields
// may be filtered - everything encrypted is opaque to the server.
type ItemListOptions struct {
	FolderID      *vault.FolderID
	ItemType      *vault.ItemType
	FavoritesOnly bool
}

// FolderRepository persists folder rows.
type FolderRepository interface {
	Create(ctx context.Context, f vault.Folder) error
	Get(ctx context.Context, vaultID vault.ID, folderID vault.FolderID) (vault.Folder, error)
	// Update currently only mutates encrypted_name.
	Update(ctx context.Context, f vault.Folder) error
	// Delete removes the folder. Items previously assigned to the folder
	// are returned to "root" (folder_id = NULL) by the ON DELETE SET NULL
	// foreign-key in PRD §9.3.
	Delete(ctx context.Context, vaultID vault.ID, folderID vault.FolderID) error
	List(ctx context.Context, vaultID vault.ID) ([]vault.Folder, error)
}
