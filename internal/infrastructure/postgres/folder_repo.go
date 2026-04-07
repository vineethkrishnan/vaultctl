package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// FolderRepo is the pgx-backed ports.FolderRepository.
type FolderRepo struct{ Pool *Pool }

func (r *FolderRepo) Create(ctx context.Context, f vault.Folder) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO folders (id, vault_id, encrypted_name, created_at) VALUES ($1,$2,$3,$4)
	`, string(f.ID), string(f.VaultID), encodeBlob(f.EncryptedName), f.CreatedAt)
	return err
}

func (r *FolderRepo) Get(ctx context.Context, vaultID vault.ID, folderID vault.FolderID) (vault.Folder, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, vault_id, encrypted_name, created_at
		FROM folders WHERE id = $1 AND vault_id = $2
	`, string(folderID), string(vaultID))
	var (
		id, vid, encName string
		createdAt        time.Time
	)
	if err := row.Scan(&id, &vid, &encName, &createdAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return vault.Folder{}, domain.ErrNotFound
		}
		return vault.Folder{}, err
	}
	blob, err := decodeBlob(encName)
	if err != nil {
		return vault.Folder{}, err
	}
	return vault.Folder{
		ID: vault.FolderID(id), VaultID: vault.ID(vid), EncryptedName: blob, CreatedAt: createdAt,
	}, nil
}

func (r *FolderRepo) Update(ctx context.Context, f vault.Folder) error {
	tag, err := r.Pool.Exec(ctx, `
		UPDATE folders SET encrypted_name = $3 WHERE id = $1 AND vault_id = $2
	`, string(f.ID), string(f.VaultID), encodeBlob(f.EncryptedName))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *FolderRepo) Delete(ctx context.Context, vaultID vault.ID, folderID vault.FolderID) error {
	_, err := r.Pool.Exec(ctx, `DELETE FROM folders WHERE id = $1 AND vault_id = $2`, string(folderID), string(vaultID))
	return err
}

func (r *FolderRepo) List(ctx context.Context, vaultID vault.ID) ([]vault.Folder, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT id, vault_id, encrypted_name, created_at FROM folders WHERE vault_id = $1 ORDER BY created_at
	`, string(vaultID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []vault.Folder{}
	for rows.Next() {
		var (
			id, vid, encName string
			createdAt        time.Time
		)
		if err := rows.Scan(&id, &vid, &encName, &createdAt); err != nil {
			return nil, err
		}
		blob, err := decodeBlob(encName)
		if err != nil {
			return nil, err
		}
		out = append(out, vault.Folder{
			ID: vault.FolderID(id), VaultID: vault.ID(vid), EncryptedName: blob, CreatedAt: createdAt,
		})
	}
	return out, rows.Err()
}
