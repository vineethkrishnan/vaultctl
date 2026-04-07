package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// ItemRepo is the pgx-backed ports.ItemRepository.
//
// EVERY query includes `WHERE vault_id = $1 AND id = $2` so that a
// cross-vault UUID substitution returns no rows — the SQL enforcement of
// the H11 IDOR guard.
type ItemRepo struct{ Pool *Pool }

func (r *ItemRepo) Create(ctx context.Context, it vault.Item) error {
	var folderID *string
	if it.FolderID != nil {
		s := string(*it.FolderID)
		folderID = &s
	}
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO vault_items (id, vault_id, folder_id, item_type, encrypted_data, encrypted_name,
		                         favorite, reprompt, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	`, string(it.ID), string(it.VaultID), folderID, string(it.ItemType),
		encodeBlob(it.EncryptedData), encodeBlob(it.EncryptedName),
		it.Favorite, it.Reprompt, it.CreatedAt, it.UpdatedAt)
	return err
}

func (r *ItemRepo) Get(ctx context.Context, vaultID vault.ID, itemID vault.ItemID) (vault.Item, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, vault_id, folder_id, item_type, encrypted_data, encrypted_name,
		       favorite, reprompt, deleted_at, created_at, updated_at
		FROM vault_items WHERE id = $1 AND vault_id = $2
	`, string(itemID), string(vaultID))
	return scanItem(row)
}

func (r *ItemRepo) Update(ctx context.Context, it vault.Item) error {
	var folderID *string
	if it.FolderID != nil {
		s := string(*it.FolderID)
		folderID = &s
	}
	tag, err := r.Pool.Exec(ctx, `
		UPDATE vault_items SET folder_id = $3, encrypted_data = $4, encrypted_name = $5,
		       favorite = $6, reprompt = $7, updated_at = $8
		WHERE id = $1 AND vault_id = $2
	`, string(it.ID), string(it.VaultID), folderID,
		encodeBlob(it.EncryptedData), encodeBlob(it.EncryptedName),
		it.Favorite, it.Reprompt, it.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *ItemRepo) SoftDelete(ctx context.Context, vaultID vault.ID, itemID vault.ItemID, at time.Time) error {
	return r.setDeleted(ctx, vaultID, itemID, &at)
}

func (r *ItemRepo) Restore(ctx context.Context, vaultID vault.ID, itemID vault.ItemID, at time.Time) error {
	return r.setDeleted(ctx, vaultID, itemID, nil)
}

func (r *ItemRepo) setDeleted(ctx context.Context, vaultID vault.ID, itemID vault.ItemID, at *time.Time) error {
	tag, err := r.Pool.Exec(ctx, `
		UPDATE vault_items SET deleted_at = $3, updated_at = NOW()
		WHERE id = $1 AND vault_id = $2
	`, string(itemID), string(vaultID), at)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *ItemRepo) HardDelete(ctx context.Context, vaultID vault.ID, itemID vault.ItemID) error {
	_, err := r.Pool.Exec(ctx, `DELETE FROM vault_items WHERE id = $1 AND vault_id = $2`, string(itemID), string(vaultID))
	return err
}

func (r *ItemRepo) ListActive(ctx context.Context, vaultID vault.ID, opts ports.ItemListOptions) ([]vault.Item, error) {
	sb := strings.Builder{}
	sb.WriteString(`SELECT id, vault_id, folder_id, item_type, encrypted_data, encrypted_name,
	                  favorite, reprompt, deleted_at, created_at, updated_at
	                  FROM vault_items WHERE vault_id = $1 AND deleted_at IS NULL`)
	args := []any{string(vaultID)}
	if opts.FolderID != nil {
		args = append(args, string(*opts.FolderID))
		sb.WriteString(fmt.Sprintf(" AND folder_id = $%d", len(args)))
	}
	if opts.ItemType != nil {
		args = append(args, string(*opts.ItemType))
		sb.WriteString(fmt.Sprintf(" AND item_type = $%d", len(args)))
	}
	if opts.FavoritesOnly {
		sb.WriteString(" AND favorite = TRUE")
	}
	sb.WriteString(" ORDER BY updated_at DESC")
	return r.queryItems(ctx, sb.String(), args...)
}

func (r *ItemRepo) ListTrashed(ctx context.Context, vaultID vault.ID) ([]vault.Item, error) {
	return r.queryItems(ctx, `
		SELECT id, vault_id, folder_id, item_type, encrypted_data, encrypted_name,
		       favorite, reprompt, deleted_at, created_at, updated_at
		FROM vault_items WHERE vault_id = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC
	`, string(vaultID))
}

func (r *ItemRepo) PurgeExpired(ctx context.Context, cutoff time.Time) (int, error) {
	tag, err := r.Pool.Exec(ctx, `DELETE FROM vault_items WHERE deleted_at IS NOT NULL AND deleted_at < $1`, cutoff)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func (r *ItemRepo) queryItems(ctx context.Context, sql string, args ...any) ([]vault.Item, error) {
	rows, err := r.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []vault.Item{}
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

type rowScanner interface {
	Scan(...any) error
}

func scanItem(row rowScanner) (vault.Item, error) {
	var (
		id, vid, itemType        string
		folderID                 *string
		encData, encName         string
		favorite, reprompt       bool
		deletedAt                *time.Time
		createdAt, updatedAt     time.Time
	)
	err := row.Scan(&id, &vid, &folderID, &itemType, &encData, &encName,
		&favorite, &reprompt, &deletedAt, &createdAt, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return vault.Item{}, domain.ErrNotFound
	}
	if err != nil {
		return vault.Item{}, err
	}
	data, err := decodeBlob(encData)
	if err != nil {
		return vault.Item{}, err
	}
	name, err := decodeBlob(encName)
	if err != nil {
		return vault.Item{}, err
	}
	var fid *vault.FolderID
	if folderID != nil {
		v := vault.FolderID(*folderID)
		fid = &v
	}
	return vault.Item{
		ID: vault.ItemID(id), VaultID: vault.ID(vid), FolderID: fid,
		ItemType: vault.ItemType(itemType), EncryptedData: data, EncryptedName: name,
		Favorite: favorite, Reprompt: reprompt, DeletedAt: deletedAt,
		CreatedAt: createdAt, UpdatedAt: updatedAt,
	}, nil
}
