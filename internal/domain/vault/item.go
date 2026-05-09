// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// ItemID is the vault item identifier.
type ItemID string

// String returns the underlying string.
func (i ItemID) String() string { return string(i) }

// IsZero reports whether the ID is unset.
func (i ItemID) IsZero() bool { return i == "" }

// FolderID is the folder identifier (optional per item).
type FolderID string

// Item is the encrypted vault item. The domain never holds plaintext; both
// EncryptedData and EncryptedName are opaque versioned blobs (alg=AES-256-GCM,
// key=the vault's symmetric key).
//
// EncryptedName is padded to the next 32-byte boundary BEFORE encryption
// (M5). The padding is applied client-side; the domain only verifies blob
// validity.
type Item struct {
	ID            ItemID
	VaultID       ID
	FolderID      *FolderID
	ItemType      ItemType
	EncryptedData crypto.EncryptedBlob
	EncryptedName crypto.EncryptedBlob
	Favorite      bool
	// Reprompt requires a master-password re-entry to reveal secrets for
	// this item, even inside an active session (PRD §5.11).
	Reprompt  bool
	DeletedAt *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Validate asserts the Item invariants.
func (i Item) Validate() error {
	if i.ID.IsZero() {
		return domain.NewInvalid("id", "required")
	}
	if i.VaultID.IsZero() {
		return domain.NewInvalid("vault_id", "required")
	}
	if !i.ItemType.IsValid() {
		return domain.NewInvalid("item_type", "invalid")
	}
	if err := i.EncryptedData.Validate(); err != nil {
		return domain.NewInvalid("encrypted_data", err.Error())
	}
	if i.EncryptedData.Alg != crypto.AlgAES256GCM {
		return domain.NewInvalid("encrypted_data", "items must use AES-256-GCM")
	}
	if err := i.EncryptedName.Validate(); err != nil {
		return domain.NewInvalid("encrypted_name", err.Error())
	}
	if i.EncryptedName.Alg != crypto.AlgAES256GCM {
		return domain.NewInvalid("encrypted_name", "items must use AES-256-GCM")
	}
	return nil
}

// IsTrashed reports whether the item is soft-deleted.
func (i Item) IsTrashed() bool { return i.DeletedAt != nil }

// BelongsToVault checks the IDOR guard required by M3 AC / H11: the caller
// passes both the URL path vault_id and the loaded item; this helper verifies
// they match. Handlers MUST call it.
func (i Item) BelongsToVault(v ID) bool { return i.VaultID == v }

// Trash returns a NEW Item marked as trashed at `at`.
func (i Item) Trash(at time.Time) Item {
	out := i
	out.DeletedAt = &at
	out.UpdatedAt = at
	return out
}

// Restore returns a NEW Item with DeletedAt cleared.
func (i Item) Restore(at time.Time) Item {
	out := i
	out.DeletedAt = nil
	out.UpdatedAt = at
	return out
}
