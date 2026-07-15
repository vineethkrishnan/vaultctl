// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// SessionStore is the pgx-backed ports.SessionStore.
type SessionStore struct{ Pool *Pool }

func (s *SessionStore) Create(ctx context.Context, sess user.Session) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO sessions (id, user_id, refresh_token_hash, device_name, ip_address, expires_at, created_at)
		VALUES ($1, $2, $3, $4, NULLIF($5,'')::inet, $6, $7)
	`, string(sess.ID), string(sess.UserID), sess.TokenHash.Bytes(), sess.DeviceName, sess.IPAddress, sess.ExpiresAt, sess.CreatedAt)
	return err
}

func (s *SessionStore) FindByTokenHash(ctx context.Context, h user.RefreshTokenHash) (user.Session, error) {
	return s.scanSession(s.Pool.QueryRow(ctx, `
		SELECT id, user_id, refresh_token_hash, COALESCE(device_name,''), COALESCE(ip_address::text,''),
		       last_refresh_at, expires_at, created_at
		FROM sessions WHERE refresh_token_hash = $1
	`, h.Bytes()))
}

// FindBySupersededTokenHash looks up a session by the hash it was rotated AWAY
// from (previous_token_hash). A hit means a refresh token that has already been
// rotated is being presented again - the reuse/theft signal (security M1).
func (s *SessionStore) FindBySupersededTokenHash(ctx context.Context, h user.RefreshTokenHash) (user.Session, error) {
	return s.scanSession(s.Pool.QueryRow(ctx, `
		SELECT id, user_id, refresh_token_hash, COALESCE(device_name,''), COALESCE(ip_address::text,''),
		       last_refresh_at, expires_at, created_at
		FROM sessions WHERE previous_token_hash = $1
	`, h.Bytes()))
}

func (s *SessionStore) scanSession(row pgx.Row) (user.Session, error) {
	var (
		id, uid, device, ip  string
		hashBytes            []byte
		lastRefresh          *time.Time
		expiresAt, createdAt time.Time
	)
	err := row.Scan(&id, &uid, &hashBytes, &device, &ip, &lastRefresh, &expiresAt, &createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return user.Session{}, domain.ErrNotFound
	}
	if err != nil {
		return user.Session{}, err
	}
	tokenHash, err := user.NewRefreshTokenHash(hashBytes)
	if err != nil {
		return user.Session{}, err
	}
	return user.Session{
		ID:            user.SessionID(id),
		UserID:        user.ID(uid),
		TokenHash:     tokenHash,
		DeviceName:    device,
		IPAddress:     ip,
		LastRefreshAt: lastRefresh,
		ExpiresAt:     expiresAt,
		CreatedAt:     createdAt,
	}, nil
}

func (s *SessionStore) Revoke(ctx context.Context, id user.SessionID) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, string(id))
	return err
}

func (s *SessionStore) Rotate(ctx context.Context, id user.SessionID, newHash user.RefreshTokenHash, at, expiresAt time.Time) error {
	tag, err := s.Pool.Exec(ctx, `
		UPDATE sessions
		SET previous_token_hash = refresh_token_hash,
		    refresh_token_hash = $1,
		    last_refresh_at = $2,
		    expires_at = $3
		WHERE id = $4
	`, newHash.Bytes(), at, expiresAt, string(id))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *SessionStore) RevokeAllForUser(ctx context.Context, userID user.ID) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, string(userID))
	return err
}

func (s *SessionStore) RevokeByDevice(ctx context.Context, userID user.ID, deviceName string) error {
	_, err := s.Pool.Exec(ctx,
		`DELETE FROM sessions WHERE user_id = $1 AND device_name = $2`,
		string(userID), deviceName)
	return err
}

func (s *SessionStore) PurgeExpired(ctx context.Context) (int, error) {
	tag, err := s.Pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at < NOW()`)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func (s *SessionStore) ListForUser(ctx context.Context, userID user.ID) ([]user.Session, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, user_id, refresh_token_hash, COALESCE(device_name,''), COALESCE(ip_address::text,''),
		       last_refresh_at, expires_at, created_at
		FROM sessions WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC
	`, string(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []user.Session{}
	for rows.Next() {
		var (
			id, uid, device, ip  string
			hashBytes            []byte
			lastRefresh          *time.Time
			expiresAt, createdAt time.Time
		)
		if err := rows.Scan(&id, &uid, &hashBytes, &device, &ip, &lastRefresh, &expiresAt, &createdAt); err != nil {
			return nil, err
		}
		tokenHash, err := user.NewRefreshTokenHash(hashBytes)
		if err != nil {
			return nil, err
		}
		out = append(out, user.Session{
			ID: user.SessionID(id), UserID: user.ID(uid), TokenHash: tokenHash,
			DeviceName: device, IPAddress: ip, LastRefreshAt: lastRefresh,
			ExpiresAt: expiresAt, CreatedAt: createdAt,
		})
	}
	return out, rows.Err()
}
