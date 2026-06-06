// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// DigestPrefsRepo implements ports.DigestPrefsRepository.
type DigestPrefsRepo struct{ Pool *Pool }

// Get returns the user's preference, defaulting to "off" when no row exists.
func (r *DigestPrefsRepo) Get(ctx context.Context, userID user.ID) (ports.DigestPref, error) {
	var p ports.DigestPref
	err := r.Pool.QueryRow(ctx, `
		SELECT frequency, next_run_at, last_run_at, login_alerts FROM user_digest_prefs WHERE user_id = $1
	`, string(userID)).Scan(&p.Frequency, &p.NextRunAt, &p.LastRunAt, &p.LoginAlerts)
	if errors.Is(err, pgx.ErrNoRows) {
		return ports.DigestPref{Frequency: "off", LoginAlerts: true}, nil
	}
	if err != nil {
		return ports.DigestPref{}, fmt.Errorf("get digest pref: %w", err)
	}
	return p, nil
}

// SetLoginAlerts upserts the user's sign-in alert opt-in without disturbing
// their digest frequency. A fresh row defaults frequency to 'off'.
func (r *DigestPrefsRepo) SetLoginAlerts(ctx context.Context, userID user.ID, enabled bool, now time.Time) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO user_digest_prefs (user_id, login_alerts, updated_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		SET login_alerts = EXCLUDED.login_alerts, updated_at = EXCLUDED.updated_at
	`, string(userID), enabled, now)
	if err != nil {
		return fmt.Errorf("set login alerts pref: %w", err)
	}
	return nil
}

// LoginAlertsEnabled reports whether the user receives sign-in alert emails,
// defaulting to true when no preference row exists.
func (r *DigestPrefsRepo) LoginAlertsEnabled(ctx context.Context, userID user.ID) (bool, error) {
	var enabled bool
	err := r.Pool.QueryRow(ctx, `
		SELECT login_alerts FROM user_digest_prefs WHERE user_id = $1
	`, string(userID)).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("get login alerts pref: %w", err)
	}
	return enabled, nil
}

// Set upserts the frequency and computed next run.
func (r *DigestPrefsRepo) Set(ctx context.Context, userID user.ID, frequency string, nextRunAt *time.Time, now time.Time) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO user_digest_prefs (user_id, frequency, next_run_at, updated_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE
		SET frequency = EXCLUDED.frequency, next_run_at = EXCLUDED.next_run_at, updated_at = EXCLUDED.updated_at
	`, string(userID), frequency, nextRunAt, now)
	if err != nil {
		return fmt.Errorf("set digest pref: %w", err)
	}
	return nil
}

// ClaimDue atomically claims every due digest, advancing next_run_at by the
// row's frequency and setting last_run_at = now in the same UPDATE, then
// returns the claimed rows with their PRIOR last_run_at (for the activity
// window). The single statement means a row is claimed before any send, so an
// overlapping or crashed run can't double-send.
func (r *DigestPrefsRepo) ClaimDue(ctx context.Context, now time.Time) ([]ports.DueDigest, error) {
	rows, err := r.Pool.Query(ctx, `
		WITH due AS (
			SELECT p.user_id, u.email, p.frequency, p.last_run_at AS prior_last_run_at
			FROM user_digest_prefs p JOIN users u ON u.id = p.user_id
			WHERE p.frequency IN ('daily','weekly','monthly','quarterly','yearly')
			  AND p.next_run_at IS NOT NULL AND p.next_run_at <= $1
			FOR UPDATE OF p SKIP LOCKED
		),
		claimed AS (
			UPDATE user_digest_prefs p
			SET last_run_at = $1,
			    next_run_at = $1 + CASE due.frequency
			        WHEN 'daily'     THEN INTERVAL '1 day'
			        WHEN 'weekly'    THEN INTERVAL '7 days'
			        WHEN 'monthly'   THEN INTERVAL '1 month'
			        WHEN 'quarterly' THEN INTERVAL '3 months'
			        WHEN 'yearly'    THEN INTERVAL '1 year'
			    END,
			    updated_at = $1
			FROM due
			WHERE p.user_id = due.user_id
			RETURNING p.user_id
		)
		SELECT due.user_id, due.email, due.frequency, due.prior_last_run_at FROM due
	`, now)
	if err != nil {
		return nil, fmt.Errorf("claim due digests: %w", err)
	}
	defer rows.Close()

	var due []ports.DueDigest
	for rows.Next() {
		var d ports.DueDigest
		var uid string
		var priorLastRun *time.Time
		if err := rows.Scan(&uid, &d.Email, &d.Frequency, &priorLastRun); err != nil {
			return nil, fmt.Errorf("scan due digest: %w", err)
		}
		d.UserID = user.ID(uid)
		d.LastRunAt = priorLastRun
		due = append(due, d)
	}
	return due, rows.Err()
}

// DigestActivityRepo implements ports.DigestActivityReader.
type DigestActivityRepo struct{ Pool *Pool }

// Summary aggregates a user's server-visible activity in one query.
func (r *DigestActivityRepo) Summary(ctx context.Context, userID user.ID, since, staleBefore time.Time) (ports.DigestActivity, error) {
	var a ports.DigestActivity
	err := r.Pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM audit_logs
			   WHERE user_id = $1 AND action = 'login.success' AND created_at >= $2),
			(SELECT COUNT(*) FROM known_logins
			   WHERE user_id = $1 AND created_at >= $2),
			(SELECT COUNT(*) FROM vault_items vi
			   JOIN vault_members vm ON vm.vault_id = vi.vault_id
			   WHERE vm.user_id = $1 AND vm.removed_at IS NULL
			     AND vi.deleted_at IS NULL AND vi.created_at >= $2),
			(SELECT COUNT(*) FROM vault_items vi
			   JOIN vault_members vm ON vm.vault_id = vi.vault_id
			   WHERE vm.user_id = $1 AND vm.removed_at IS NULL
			     AND vi.deleted_at IS NULL AND vi.item_type = 'login' AND vi.updated_at < $3)
	`, string(userID), since, staleBefore).Scan(&a.Logins, &a.NewDevices, &a.ItemsAdded, &a.StaleLogins)
	if err != nil {
		return ports.DigestActivity{}, fmt.Errorf("digest summary: %w", err)
	}
	return a, nil
}
