// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// EmailVerificationRepo implements ports.EmailVerificationRepository over the
// email_verifications table (one active code per user).
type EmailVerificationRepo struct{ Pool *Pool }

// Upsert stores the active code for a user, replacing any prior one and
// resetting the attempt counter.
func (r *EmailVerificationRepo) Upsert(ctx context.Context, v user.EmailVerification) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO email_verifications (user_id, code_hash, expires_at, attempts, created_at)
		VALUES ($1, $2, $3, 0, $4)
		ON CONFLICT (user_id) DO UPDATE
		SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
		    attempts = 0, created_at = EXCLUDED.created_at
	`, string(v.UserID), v.CodeHash, v.ExpiresAt, v.CreatedAt)
	if err != nil {
		return fmt.Errorf("upsert email verification: %w", err)
	}
	return nil
}

// Get returns the active code for a user, or domain.ErrNotFound when none.
func (r *EmailVerificationRepo) Get(ctx context.Context, userID user.ID) (user.EmailVerification, error) {
	v := user.EmailVerification{UserID: userID}
	err := r.Pool.QueryRow(ctx, `
		SELECT code_hash, expires_at, attempts, created_at
		FROM email_verifications WHERE user_id = $1
	`, string(userID)).Scan(&v.CodeHash, &v.ExpiresAt, &v.Attempts, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return user.EmailVerification{}, domain.ErrNotFound
	}
	if err != nil {
		return user.EmailVerification{}, fmt.Errorf("get email verification: %w", err)
	}
	return v, nil
}

// RegisterAttempt atomically consumes one attempt while the code is live and
// under the cap, returning the stored code hash for comparison. A zero-row
// update (ok=false) means no pending, expired, or exhausted code.
func (r *EmailVerificationRepo) RegisterAttempt(ctx context.Context, userID user.ID, maxAttempts int, now time.Time) (codeHash []byte, ok bool, err error) {
	err = r.Pool.QueryRow(ctx, `
		UPDATE email_verifications
		SET attempts = attempts + 1
		WHERE user_id = $1 AND attempts < $2 AND expires_at > $3
		RETURNING code_hash
	`, string(userID), maxAttempts, now).Scan(&codeHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("register verification attempt: %w", err)
	}
	return codeHash, true, nil
}

// Delete removes a user's code.
func (r *EmailVerificationRepo) Delete(ctx context.Context, userID user.ID) error {
	_, err := r.Pool.Exec(ctx, `DELETE FROM email_verifications WHERE user_id = $1`, string(userID))
	if err != nil {
		return fmt.Errorf("delete email verification: %w", err)
	}
	return nil
}

// PurgeExpired deletes codes whose lifetime ended before now. Returns the
// number of rows removed.
func (r *EmailVerificationRepo) PurgeExpired(ctx context.Context, now time.Time) (int64, error) {
	tag, err := r.Pool.Exec(ctx, `DELETE FROM email_verifications WHERE expires_at < $1`, now)
	if err != nil {
		return 0, fmt.Errorf("purge expired email verifications: %w", err)
	}
	return tag.RowsAffected(), nil
}
