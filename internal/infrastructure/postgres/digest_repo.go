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
// The timezone lives on the users row, so it is read even when no pref row
// exists (a fresh user still has a timezone, defaulting to 'UTC').
func (r *DigestPrefsRepo) Get(ctx context.Context, userID user.ID) (ports.DigestPref, error) {
	var (
		p           ports.DigestPref
		frequency   *string
		loginAlerts *bool
		timezone    string
	)
	err := r.Pool.QueryRow(ctx, `
		SELECT p.frequency, p.next_run_at, p.last_run_at, p.login_alerts,
		       p.sched_hour, p.sched_minute, p.sched_weekday, p.sched_day, p.sched_month,
		       u.timezone
		FROM users u LEFT JOIN user_digest_prefs p ON p.user_id = u.id
		WHERE u.id = $1
	`, string(userID)).Scan(
		&frequency, &p.NextRunAt, &p.LastRunAt, &loginAlerts,
		&p.Schedule.Hour, &p.Schedule.Minute, &p.Schedule.Weekday, &p.Schedule.Day, &p.Schedule.Month,
		&timezone)
	if errors.Is(err, pgx.ErrNoRows) {
		return ports.DigestPref{Frequency: "off", LoginAlerts: true, Timezone: user.DefaultTimezone}, nil
	}
	if err != nil {
		return ports.DigestPref{}, fmt.Errorf("get digest pref: %w", err)
	}
	p.Frequency = "off"
	if frequency != nil {
		p.Frequency = *frequency
	}
	p.LoginAlerts = true
	if loginAlerts != nil {
		p.LoginAlerts = *loginAlerts
	}
	p.Timezone = user.NormalizeTimezone(timezone)
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

// Set upserts the frequency, granular schedule, and computed next run.
func (r *DigestPrefsRepo) Set(ctx context.Context, userID user.ID, frequency string, schedule ports.DigestSchedule, nextRunAt *time.Time, now time.Time) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO user_digest_prefs
			(user_id, frequency, next_run_at, sched_hour, sched_minute, sched_weekday, sched_day, sched_month, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (user_id) DO UPDATE
		SET frequency = EXCLUDED.frequency, next_run_at = EXCLUDED.next_run_at,
		    sched_hour = EXCLUDED.sched_hour, sched_minute = EXCLUDED.sched_minute,
		    sched_weekday = EXCLUDED.sched_weekday, sched_day = EXCLUDED.sched_day,
		    sched_month = EXCLUDED.sched_month, updated_at = EXCLUDED.updated_at
	`, string(userID), frequency, nextRunAt,
		schedule.Hour, schedule.Minute, schedule.Weekday, schedule.Day, schedule.Month, now)
	if err != nil {
		return fmt.Errorf("set digest pref: %w", err)
	}
	return nil
}

// Reschedule overwrites a claimed row's next_run_at with the schedule-aware
// value computed in Go after ClaimDue.
func (r *DigestPrefsRepo) Reschedule(ctx context.Context, userID user.ID, nextRunAt *time.Time, now time.Time) error {
	_, err := r.Pool.Exec(ctx, `
		UPDATE user_digest_prefs SET next_run_at = $2, updated_at = $3 WHERE user_id = $1
	`, string(userID), nextRunAt, now)
	if err != nil {
		return fmt.Errorf("reschedule digest pref: %w", err)
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
			SELECT p.user_id, u.email, u.locale, u.timezone, p.frequency, p.last_run_at AS prior_last_run_at,
			       p.sched_hour, p.sched_minute, p.sched_weekday, p.sched_day, p.sched_month
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
		SELECT due.user_id, due.email, due.locale, due.timezone, due.frequency, due.prior_last_run_at,
		       due.sched_hour, due.sched_minute, due.sched_weekday, due.sched_day, due.sched_month
		FROM due
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
		if err := rows.Scan(&uid, &d.Email, &d.Locale, &d.Timezone, &d.Frequency, &priorLastRun,
			&d.Schedule.Hour, &d.Schedule.Minute, &d.Schedule.Weekday, &d.Schedule.Day, &d.Schedule.Month); err != nil {
			return nil, fmt.Errorf("scan due digest: %w", err)
		}
		d.UserID = user.ID(uid)
		d.Locale = user.NormalizeLocale(d.Locale)
		d.Timezone = user.NormalizeTimezone(d.Timezone)
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
