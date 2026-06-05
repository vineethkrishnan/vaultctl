// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"context"
	"errors"
	"fmt"

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

// IncrementAttempts bumps the wrong-guess counter.
func (r *EmailVerificationRepo) IncrementAttempts(ctx context.Context, userID user.ID) error {
	_, err := r.Pool.Exec(ctx, `
		UPDATE email_verifications SET attempts = attempts + 1 WHERE user_id = $1
	`, string(userID))
	if err != nil {
		return fmt.Errorf("increment verification attempts: %w", err)
	}
	return nil
}

// Delete removes a user's code.
func (r *EmailVerificationRepo) Delete(ctx context.Context, userID user.ID) error {
	_, err := r.Pool.Exec(ctx, `DELETE FROM email_verifications WHERE user_id = $1`, string(userID))
	if err != nil {
		return fmt.Errorf("delete email verification: %w", err)
	}
	return nil
}
