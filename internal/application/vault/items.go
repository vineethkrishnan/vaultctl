package vault

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// CreateItemInput is the payload to insert a new item. EncryptedData and
// EncryptedName MUST already carry v1|AES-256-GCM headers (client does the
// encryption — see PRD §9.9/C5).
type CreateItemInput struct {
	Caller        user.ID
	VaultID       domainvault.ID
	FolderID      *domainvault.FolderID
	ItemType      domainvault.ItemType
	EncryptedData crypto.EncryptedBlob
	EncryptedName crypto.EncryptedBlob
	Favorite      bool
	Reprompt      bool
}

// CreateItem inserts a new encrypted item into a vault.
type CreateItem struct {
	Vaults ports.VaultRepository
	Items  ports.ItemRepository
	Clock  ports.Clock
	IDs    ports.IDGenerator
}

// Execute performs authorization + insertion.
func (uc *CreateItem) Execute(ctx context.Context, in CreateItemInput) (domainvault.Item, error) {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return domainvault.Item{}, err
	}
	now := uc.Clock.Now()
	item := domainvault.Item{
		ID:            domainvault.ItemID(uc.IDs.NewID()),
		VaultID:       in.VaultID,
		FolderID:      in.FolderID,
		ItemType:      in.ItemType,
		EncryptedData: in.EncryptedData,
		EncryptedName: in.EncryptedName,
		Favorite:      in.Favorite,
		Reprompt:      in.Reprompt,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := item.Validate(); err != nil {
		return domainvault.Item{}, err
	}
	if err := uc.Items.Create(ctx, item); err != nil {
		return domainvault.Item{}, fmt.Errorf("persist item: %w", err)
	}
	return item, nil
}

// GetItemInput asks for a specific item.
type GetItemInput struct {
	Caller  user.ID
	VaultID domainvault.ID
	ItemID  domainvault.ItemID
}

// GetItem loads an item, enforcing both membership AND vault_id binding
// (H11). Returns ErrNotFound for any of: item missing, item belongs to
// a different vault, caller not a member.
type GetItem struct {
	Vaults ports.VaultRepository
	Items  ports.ItemRepository
}

// Execute runs the use case.
func (uc *GetItem) Execute(ctx context.Context, in GetItemInput) (domainvault.Item, error) {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return domainvault.Item{}, err
	}
	item, err := uc.Items.Get(ctx, in.VaultID, in.ItemID)
	if err != nil {
		return domainvault.Item{}, err
	}
	// Defence-in-depth: repository already scopes on vault_id, but check
	// here too so a buggy repo can never bypass H11.
	if !item.BelongsToVault(in.VaultID) {
		return domainvault.Item{}, domain.ErrNotFound
	}
	return item, nil
}

// UpdateItemInput mutates an existing item's encrypted payload + metadata.
type UpdateItemInput struct {
	Caller        user.ID
	VaultID       domainvault.ID
	ItemID        domainvault.ItemID
	FolderID      *domainvault.FolderID
	EncryptedData crypto.EncryptedBlob
	EncryptedName crypto.EncryptedBlob
	Favorite      bool
	Reprompt      bool
}

// UpdateItem applies an update, enforcing IDOR guards.
type UpdateItem struct {
	Vaults ports.VaultRepository
	Items  ports.ItemRepository
	Clock  ports.Clock
}

// Execute runs the use case.
func (uc *UpdateItem) Execute(ctx context.Context, in UpdateItemInput) (domainvault.Item, error) {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return domainvault.Item{}, err
	}
	current, err := uc.Items.Get(ctx, in.VaultID, in.ItemID)
	if err != nil {
		return domainvault.Item{}, err
	}
	if !current.BelongsToVault(in.VaultID) {
		return domainvault.Item{}, domain.ErrNotFound
	}
	// Cannot update a trashed item.
	if current.IsTrashed() {
		return domainvault.Item{}, domain.NewInvalid("item", "trashed items must be restored first")
	}
	now := uc.Clock.Now()
	updated := current
	updated.FolderID = in.FolderID
	updated.EncryptedData = in.EncryptedData
	updated.EncryptedName = in.EncryptedName
	updated.Favorite = in.Favorite
	updated.Reprompt = in.Reprompt
	updated.UpdatedAt = now

	if err := updated.Validate(); err != nil {
		return domainvault.Item{}, err
	}
	if err := uc.Items.Update(ctx, updated); err != nil {
		return domainvault.Item{}, fmt.Errorf("persist update: %w", err)
	}
	return updated, nil
}

// TrashItemInput soft-deletes an item.
type TrashItemInput struct {
	Caller  user.ID
	VaultID domainvault.ID
	ItemID  domainvault.ItemID
}

// TrashItem moves an item to the trash (soft delete).
type TrashItem struct {
	Vaults ports.VaultRepository
	Items  ports.ItemRepository
	Clock  ports.Clock
}

// Execute runs the use case.
func (uc *TrashItem) Execute(ctx context.Context, in TrashItemInput) error {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return err
	}
	current, err := uc.Items.Get(ctx, in.VaultID, in.ItemID)
	if err != nil {
		return err
	}
	if !current.BelongsToVault(in.VaultID) {
		return domain.ErrNotFound
	}
	if current.IsTrashed() {
		return nil // idempotent
	}
	return uc.Items.SoftDelete(ctx, in.VaultID, in.ItemID, uc.Clock.Now())
}

// RestoreItemInput un-trashes an item.
type RestoreItemInput struct {
	Caller  user.ID
	VaultID domainvault.ID
	ItemID  domainvault.ItemID
}

// RestoreItem is the "undo delete" use case.
type RestoreItem struct {
	Vaults ports.VaultRepository
	Items  ports.ItemRepository
	Clock  ports.Clock
}

// Execute runs the use case.
func (uc *RestoreItem) Execute(ctx context.Context, in RestoreItemInput) error {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return err
	}
	current, err := uc.Items.Get(ctx, in.VaultID, in.ItemID)
	if err != nil {
		return err
	}
	if !current.BelongsToVault(in.VaultID) {
		return domain.ErrNotFound
	}
	if !current.IsTrashed() {
		return nil // idempotent
	}
	return uc.Items.Restore(ctx, in.VaultID, in.ItemID, uc.Clock.Now())
}

// PurgeItemInput permanently deletes a trashed item.
type PurgeItemInput struct {
	Caller  user.ID
	VaultID domainvault.ID
	ItemID  domainvault.ItemID
}

// PurgeItem is an irreversible delete. Per H10, this endpoint requires
// step-up auth at the handler layer; the use case assumes the step-up
// check already succeeded.
type PurgeItem struct {
	Vaults ports.VaultRepository
	Items  ports.ItemRepository
}

// Execute runs the use case.
func (uc *PurgeItem) Execute(ctx context.Context, in PurgeItemInput) error {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return err
	}
	current, err := uc.Items.Get(ctx, in.VaultID, in.ItemID)
	if err != nil {
		return err
	}
	if !current.BelongsToVault(in.VaultID) {
		return domain.ErrNotFound
	}
	if !current.IsTrashed() {
		return domain.NewInvalid("item", "only trashed items may be purged")
	}
	return uc.Items.HardDelete(ctx, in.VaultID, in.ItemID)
}

// ListActiveInput selects items in a vault, with optional server-visible
// filters.
type ListActiveInput struct {
	Caller  user.ID
	VaultID domainvault.ID
	Options ports.ItemListOptions
}

// ListActive returns all non-trashed items in a vault.
type ListActive struct {
	Vaults ports.VaultRepository
	Items  ports.ItemRepository
}

// Execute runs the use case.
func (uc *ListActive) Execute(ctx context.Context, in ListActiveInput) ([]domainvault.Item, error) {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return nil, err
	}
	return uc.Items.ListActive(ctx, in.VaultID, in.Options)
}

// ListTrashInput selects trashed items in a vault.
type ListTrashInput struct {
	Caller  user.ID
	VaultID domainvault.ID
}

// ListTrash returns trashed items.
type ListTrash struct {
	Vaults ports.VaultRepository
	Items  ports.ItemRepository
}

// Execute runs the use case.
func (uc *ListTrash) Execute(ctx context.Context, in ListTrashInput) ([]domainvault.Item, error) {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return nil, err
	}
	return uc.Items.ListTrashed(ctx, in.VaultID)
}

// PurgeExpiredTrash is the cron-driven cleanup. No authorization check is
// required — this runs as the cron user, not as any tenant.
type PurgeExpiredTrash struct {
	Items         ports.ItemRepository
	Clock         ports.Clock
	RetentionDays int
}

// Execute removes trashed items older than RetentionDays.
func (uc *PurgeExpiredTrash) Execute(ctx context.Context) (int, error) {
	if uc.RetentionDays <= 0 {
		return 0, fmt.Errorf("invalid retention: %d", uc.RetentionDays)
	}
	cutoff := uc.Clock.Now().Add(-time.Duration(uc.RetentionDays) * 24 * time.Hour)
	n, err := uc.Items.PurgeExpired(ctx, cutoff)
	if err != nil {
		return 0, fmt.Errorf("purge expired: %w", err)
	}
	return n, nil
}

// Ensure errors package reference for the grep'able sentinel.
var _ = errors.Is
