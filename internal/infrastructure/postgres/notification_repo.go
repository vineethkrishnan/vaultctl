// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

// NotificationStateRepo implements ports.NotificationStateRepository over the
// user_notification_state table (one row per user).
type NotificationStateRepo struct{ Pool *Pool }

// Get returns the user's read/clear markers, or a zero state when no row
// exists yet (never read, never cleared).
func (r *NotificationStateRepo) Get(ctx context.Context, userID string) (ports.NotificationState, error) {
	var lastRead, cleared *time.Time
	err := r.Pool.QueryRow(ctx, `
		SELECT last_read_at, cleared_at FROM user_notification_state WHERE user_id = $1
	`, userID).Scan(&lastRead, &cleared)
	if errors.Is(err, pgx.ErrNoRows) {
		return ports.NotificationState{}, nil
	}
	if err != nil {
		return ports.NotificationState{}, fmt.Errorf("get notification state: %w", err)
	}
	return ports.NotificationState{LastReadAt: lastRead, ClearedAt: cleared}, nil
}

// MarkRead sets last_read_at, upserting the row.
func (r *NotificationStateRepo) MarkRead(ctx context.Context, userID string, at time.Time) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO user_notification_state (user_id, last_read_at, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at, updated_at = NOW()
	`, userID, at)
	if err != nil {
		return fmt.Errorf("mark notifications read: %w", err)
	}
	return nil
}

// Clear sets cleared_at, upserting the row.
func (r *NotificationStateRepo) Clear(ctx context.Context, userID string, at time.Time) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO user_notification_state (user_id, cleared_at, last_read_at, updated_at)
		VALUES ($1, $2, $2, NOW())
		ON CONFLICT (user_id) DO UPDATE SET cleared_at = EXCLUDED.cleared_at, last_read_at = EXCLUDED.last_read_at, updated_at = NOW()
	`, userID, at)
	if err != nil {
		return fmt.Errorf("clear notifications: %w", err)
	}
	return nil
}
