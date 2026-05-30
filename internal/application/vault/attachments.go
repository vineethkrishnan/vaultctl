// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"io/fs"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// countReader counts the bytes read through it.
type countReader struct {
	r io.Reader
	n int64
}

func (c *countReader) Read(p []byte) (int, error) {
	m, err := c.r.Read(p)
	c.n += int64(m)
	return m, err
}

// CreateAttachmentInput streams one encrypted file onto an item. EncryptedName
// and WrappedFileKey are opaque client blobs; Body is the ciphertext stream.
type CreateAttachmentInput struct {
	Caller            user.ID
	VaultID           domainvault.ID
	ItemID            domainvault.ItemID
	EncryptedFilename string
	WrappedFileKey    string
	Body              io.Reader
}

// CreateAttachment authorizes, enforces size + per-vault quota, streams the
// ciphertext into the blob store while hashing it, and records metadata.
type CreateAttachment struct {
	Vaults          ports.VaultRepository
	Items           ports.ItemRepository
	Attachments     ports.AttachmentRepository
	Blobs           ports.BlobStore
	Clock           ports.Clock
	IDs             ports.IDGenerator
	MaxBytes        int64 // per-file cap; <=0 means unlimited
	VaultQuotaBytes int64 // per-vault total cap; <=0 means unlimited
}

// Execute runs the use case.
func (uc *CreateAttachment) Execute(ctx context.Context, in CreateAttachmentInput) (domainvault.Attachment, error) {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return domainvault.Attachment{}, err
	}
	// IDOR: the item must exist within this vault.
	item, err := uc.Items.Get(ctx, in.VaultID, in.ItemID)
	if err != nil {
		return domainvault.Attachment{}, err
	}
	if !item.BelongsToVault(in.VaultID) {
		return domainvault.Attachment{}, domain.ErrNotFound
	}
	if in.EncryptedFilename == "" || in.WrappedFileKey == "" {
		return domainvault.Attachment{}, domain.NewInvalid("attachment", "encrypted filename and wrapped key are required")
	}

	used, err := uc.Attachments.TotalSizeForVault(ctx, in.VaultID)
	if err != nil {
		return domainvault.Attachment{}, fmt.Errorf("attachment quota: %w", err)
	}
	if uc.VaultQuotaBytes > 0 && used >= uc.VaultQuotaBytes {
		return domainvault.Attachment{}, domain.NewInvalid("attachment", "vault storage quota exceeded")
	}

	storageKey := uc.IDs.NewID()
	hasher := sha256.New()
	limit := uc.MaxBytes
	if limit <= 0 {
		limit = int64(1)<<62 - 1
	}
	// LimitReader to limit+1 so we can detect an over-cap upload after the fact.
	counter := &countReader{r: io.TeeReader(io.LimitReader(in.Body, limit+1), hasher)}

	if err := uc.Blobs.Put(ctx, storageKey, counter); err != nil {
		return domainvault.Attachment{}, fmt.Errorf("store attachment: %w", err)
	}
	size := counter.n

	rollback := func() { _ = uc.Blobs.Delete(ctx, storageKey) }
	if size == 0 {
		rollback()
		return domainvault.Attachment{}, domain.NewInvalid("attachment", "file is empty")
	}
	if uc.MaxBytes > 0 && size > uc.MaxBytes {
		rollback()
		return domainvault.Attachment{}, domain.NewInvalid("attachment", "file exceeds maximum size")
	}
	if uc.VaultQuotaBytes > 0 && used+size > uc.VaultQuotaBytes {
		rollback()
		return domainvault.Attachment{}, domain.NewInvalid("attachment", "vault storage quota exceeded")
	}

	att := domainvault.Attachment{
		ID:                domainvault.AttachmentID(uc.IDs.NewID()),
		ItemID:            in.ItemID,
		VaultID:           in.VaultID,
		StorageKey:        storageKey,
		EncryptedFilename: in.EncryptedFilename,
		WrappedFileKey:    in.WrappedFileKey,
		CiphertextSize:    size,
		CiphertextSHA256:  hasher.Sum(nil),
		CreatedAt:         uc.Clock.Now(),
	}
	if err := att.Validate(); err != nil {
		rollback()
		return domainvault.Attachment{}, err
	}
	if err := uc.Attachments.Create(ctx, att); err != nil {
		rollback()
		return domainvault.Attachment{}, fmt.Errorf("persist attachment: %w", err)
	}
	return att, nil
}

// ListAttachmentsInput lists the attachments on an item.
type ListAttachmentsInput struct {
	Caller  user.ID
	VaultID domainvault.ID
	ItemID  domainvault.ItemID
}

// ListAttachments returns attachment metadata for an item.
type ListAttachments struct {
	Vaults      ports.VaultRepository
	Attachments ports.AttachmentRepository
}

// Execute runs the use case.
func (uc *ListAttachments) Execute(ctx context.Context, in ListAttachmentsInput) ([]domainvault.Attachment, error) {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return nil, err
	}
	return uc.Attachments.ListForItem(ctx, in.VaultID, in.ItemID)
}

// GetAttachmentInput fetches one attachment's bytes.
type GetAttachmentInput struct {
	Caller       user.ID
	VaultID      domainvault.ID
	ItemID       domainvault.ItemID
	AttachmentID domainvault.AttachmentID
}

// GetAttachmentResult carries metadata plus an open ciphertext stream the
// caller MUST Close.
type GetAttachmentResult struct {
	Attachment domainvault.Attachment
	Body       io.ReadCloser
}

// GetAttachment authorizes and opens the ciphertext for streaming.
type GetAttachment struct {
	Vaults      ports.VaultRepository
	Attachments ports.AttachmentRepository
	Blobs       ports.BlobStore
}

// Execute runs the use case.
func (uc *GetAttachment) Execute(ctx context.Context, in GetAttachmentInput) (GetAttachmentResult, error) {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return GetAttachmentResult{}, err
	}
	att, err := uc.Attachments.Get(ctx, in.VaultID, in.ItemID, in.AttachmentID)
	if err != nil {
		return GetAttachmentResult{}, err
	}
	if !att.BelongsToVault(in.VaultID) {
		return GetAttachmentResult{}, domain.ErrNotFound
	}
	body, err := uc.Blobs.Get(ctx, att.StorageKey)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return GetAttachmentResult{}, domain.ErrNotFound
		}
		return GetAttachmentResult{}, fmt.Errorf("open attachment: %w", err)
	}
	return GetAttachmentResult{Attachment: att, Body: body}, nil
}

// DeleteAttachmentInput removes one attachment.
type DeleteAttachmentInput struct {
	Caller       user.ID
	VaultID      domainvault.ID
	ItemID       domainvault.ItemID
	AttachmentID domainvault.AttachmentID
}

// DeleteAttachment removes the row then best-effort deletes the blob.
type DeleteAttachment struct {
	Vaults      ports.VaultRepository
	Attachments ports.AttachmentRepository
	Blobs       ports.BlobStore
}

// Execute runs the use case.
func (uc *DeleteAttachment) Execute(ctx context.Context, in DeleteAttachmentInput) error {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return err
	}
	att, err := uc.Attachments.Get(ctx, in.VaultID, in.ItemID, in.AttachmentID)
	if err != nil {
		return err
	}
	if err := uc.Attachments.Delete(ctx, in.VaultID, in.ItemID, in.AttachmentID); err != nil {
		return err
	}
	// Row gone (authoritative); blob removal is best-effort. A leftover blob
	// is harmless and reclaimable by a later sweep.
	_ = uc.Blobs.Delete(ctx, att.StorageKey)
	return nil
}
