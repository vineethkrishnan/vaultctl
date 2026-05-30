// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
)

// AttachmentID is the opaque ID of a file attached to an item.
type AttachmentID string

// IsZero reports whether the ID is unset.
func (id AttachmentID) IsZero() bool { return id == "" }

// Attachment is metadata for an encrypted file attached to a vault item.
//
// The ciphertext itself lives in the BlobStore under StorageKey; this struct
// holds only opaque, client-produced fields. The server is zero-knowledge:
// EncryptedFilename and WrappedFileKey are opaque base64 blobs it never reads.
type Attachment struct {
	ID      AttachmentID
	ItemID  ItemID
	VaultID ID
	// StorageKey is the server-generated opaque key into the BlobStore.
	StorageKey string
	// EncryptedFilename is the AES-GCM-encrypted filename (opaque to server).
	EncryptedFilename string
	// WrappedFileKey is the per-attachment file key wrapped by the vault key.
	WrappedFileKey string
	// CiphertextSize is the byte length of the stored ciphertext.
	CiphertextSize int64
	// CiphertextSHA256 is the SHA-256 of the stored ciphertext (at-rest integrity).
	CiphertextSHA256 []byte
	CreatedAt        time.Time
}

// Validate asserts the Attachment invariants.
func (a Attachment) Validate() error {
	if a.ID.IsZero() {
		return domain.NewInvalid("id", "required")
	}
	if a.ItemID.IsZero() {
		return domain.NewInvalid("item_id", "required")
	}
	if a.VaultID.IsZero() {
		return domain.NewInvalid("vault_id", "required")
	}
	if a.StorageKey == "" {
		return domain.NewInvalid("storage_key", "required")
	}
	if a.EncryptedFilename == "" {
		return domain.NewInvalid("encrypted_filename", "required")
	}
	if a.WrappedFileKey == "" {
		return domain.NewInvalid("wrapped_file_key", "required")
	}
	if a.CiphertextSize <= 0 {
		return domain.NewInvalid("ciphertext_size", "must be positive")
	}
	if len(a.CiphertextSHA256) != 32 {
		return domain.NewInvalid("ciphertext_sha256", "must be 32 bytes")
	}
	return nil
}

// BelongsToVault is the IDOR guard mirror of Item.BelongsToVault.
func (a Attachment) BelongsToVault(v ID) bool { return a.VaultID == v }
