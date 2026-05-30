// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

var _ ports.AttachmentRepository = (*AttachmentRepo)(nil)

// AttachmentRepo is the pgx-backed ports.AttachmentRepository. Every read is
// scoped by vault_id AND item_id so a cross-vault/cross-item ID substitution
// returns no rows (H11 IDOR guard).
type AttachmentRepo struct{ Pool *Pool }

func (r *AttachmentRepo) Create(ctx context.Context, a vault.Attachment) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO attachments
			(id, item_id, vault_id, storage_key, encrypted_filename, wrapped_file_key,
			 ciphertext_size, ciphertext_sha256, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, string(a.ID), string(a.ItemID), string(a.VaultID), a.StorageKey,
		a.EncryptedFilename, a.WrappedFileKey, a.CiphertextSize, a.CiphertextSHA256, a.CreatedAt)
	return err
}

func (r *AttachmentRepo) Get(ctx context.Context, vaultID vault.ID, itemID vault.ItemID, id vault.AttachmentID) (vault.Attachment, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, item_id, vault_id, storage_key, encrypted_filename, wrapped_file_key,
		       ciphertext_size, ciphertext_sha256, created_at
		FROM attachments
		WHERE id = $1 AND item_id = $2 AND vault_id = $3
	`, string(id), string(itemID), string(vaultID))
	return scanAttachment(row)
}

func (r *AttachmentRepo) ListForItem(ctx context.Context, vaultID vault.ID, itemID vault.ItemID) ([]vault.Attachment, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT id, item_id, vault_id, storage_key, encrypted_filename, wrapped_file_key,
		       ciphertext_size, ciphertext_sha256, created_at
		FROM attachments
		WHERE item_id = $1 AND vault_id = $2
		ORDER BY created_at ASC
	`, string(itemID), string(vaultID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []vault.Attachment
	for rows.Next() {
		a, err := scanAttachment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *AttachmentRepo) Delete(ctx context.Context, vaultID vault.ID, itemID vault.ItemID, id vault.AttachmentID) error {
	tag, err := r.Pool.Exec(ctx, `
		DELETE FROM attachments WHERE id = $1 AND item_id = $2 AND vault_id = $3
	`, string(id), string(itemID), string(vaultID))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *AttachmentRepo) TotalSizeForVault(ctx context.Context, vaultID vault.ID) (int64, error) {
	var total int64
	err := r.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ciphertext_size), 0) FROM attachments WHERE vault_id = $1
	`, string(vaultID)).Scan(&total)
	return total, err
}

func (r *AttachmentRepo) StorageKeysForItem(ctx context.Context, vaultID vault.ID, itemID vault.ItemID) ([]string, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT storage_key FROM attachments WHERE item_id = $1 AND vault_id = $2
	`, string(itemID), string(vaultID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

// scanAttachment uses the package-shared rowScanner (declared in item_repo.go).
func scanAttachment(row rowScanner) (vault.Attachment, error) {
	var (
		a       vault.Attachment
		id      string
		itemID  string
		vaultID string
	)
	if err := row.Scan(&id, &itemID, &vaultID, &a.StorageKey, &a.EncryptedFilename,
		&a.WrappedFileKey, &a.CiphertextSize, &a.CiphertextSHA256, &a.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return vault.Attachment{}, domain.ErrNotFound
		}
		return vault.Attachment{}, err
	}
	a.ID = vault.AttachmentID(id)
	a.ItemID = vault.ItemID(itemID)
	a.VaultID = vault.ID(vaultID)
	return a, nil
}
