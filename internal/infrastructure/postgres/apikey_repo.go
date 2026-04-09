package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// APIKeyRepo is the pgx-backed ports.APIKeyRepository.
type APIKeyRepo struct{ Pool *Pool }

func (r *APIKeyRepo) Create(ctx context.Context, key user.APIKey) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, string(key.ID), string(key.UserID), key.Name, key.KeyHash, key.KeyPrefix, key.ExpiresAt, key.CreatedAt)
	return err
}

func (r *APIKeyRepo) GetByHash(ctx context.Context, keyHash string) (user.APIKey, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, user_id, name, key_hash, key_prefix, last_used_at, expires_at, created_at
		FROM api_keys WHERE key_hash = $1
	`, keyHash)
	return scanAPIKey(row)
}

func (r *APIKeyRepo) ListByUser(ctx context.Context, userID user.ID) ([]user.APIKey, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT id, user_id, name, key_hash, key_prefix, last_used_at, expires_at, created_at
		FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC
	`, string(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []user.APIKey{}
	for rows.Next() {
		var (
			id, uid, name, hash, prefix string
			lastUsed                    *time.Time
			expiresAt                   *time.Time
			createdAt                   time.Time
		)
		if err := rows.Scan(&id, &uid, &name, &hash, &prefix, &lastUsed, &expiresAt, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, user.APIKey{
			ID: user.APIKeyID(id), UserID: user.ID(uid),
			Name: name, KeyHash: hash, KeyPrefix: prefix,
			LastUsedAt: lastUsed, ExpiresAt: expiresAt, CreatedAt: createdAt,
		})
	}
	return out, rows.Err()
}

func (r *APIKeyRepo) Delete(ctx context.Context, userID user.ID, keyID user.APIKeyID) error {
	tag, err := r.Pool.Exec(ctx,
		`DELETE FROM api_keys WHERE id = $1 AND user_id = $2`,
		string(keyID), string(userID))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *APIKeyRepo) UpdateLastUsed(ctx context.Context, keyID user.APIKeyID, now time.Time) error {
	_, err := r.Pool.Exec(ctx,
		`UPDATE api_keys SET last_used_at = $1 WHERE id = $2`,
		now, string(keyID))
	return err
}

func scanAPIKey(row pgx.Row) (user.APIKey, error) {
	var (
		id, uid, name, hash, prefix string
		lastUsed                    *time.Time
		expiresAt                   *time.Time
		createdAt                   time.Time
	)
	err := row.Scan(&id, &uid, &name, &hash, &prefix, &lastUsed, &expiresAt, &createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return user.APIKey{}, domain.ErrNotFound
	}
	if err != nil {
		return user.APIKey{}, err
	}
	return user.APIKey{
		ID: user.APIKeyID(id), UserID: user.ID(uid),
		Name: name, KeyHash: hash, KeyPrefix: prefix,
		LastUsedAt: lastUsed, ExpiresAt: expiresAt, CreatedAt: createdAt,
	}, nil
}
