// SPDX-License-Identifier: AGPL-3.0-or-later

package ports

import (
	"context"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// DigestActivity is the server-visible activity summary for one user over a
// window. Only signals the zero-knowledge server can see appear here.
type DigestActivity struct {
	Logins      int
	NewDevices  int
	ItemsAdded  int
	StaleLogins int // login items not updated within the stale threshold
}

// Empty reports whether nothing worth emailing happened.
func (a DigestActivity) Empty() bool {
	return a.Logins == 0 && a.NewDevices == 0 && a.ItemsAdded == 0 && a.StaleLogins == 0
}

// DigestSchedule carries the persisted granular schedule columns. Each pointer
// is nil when the user has not chosen that component. The application layer maps
// these to its domain Schedule; ports stays free of application-layer types.
type DigestSchedule struct {
	Hour    *int16
	Minute  *int16
	Weekday *int16
	Day     *int16
	Month   *int16
}

// DigestPref is a user's stored digest preference.
type DigestPref struct {
	Frequency string
	NextRunAt *time.Time
	LastRunAt *time.Time
	// LoginAlerts is whether new-device/new-network sign-in alert emails are
	// sent to this user. Defaults to true when no row exists.
	LoginAlerts bool
	// Timezone is the IANA name used to interpret the schedule. Empty defaults
	// to UTC at the persistence layer.
	Timezone string
	Schedule DigestSchedule
}

// DueDigest identifies a user whose digest is ready to send.
type DueDigest struct {
	UserID    user.ID
	Email     string
	Locale    string // transactional-email locale, carried so RunDue avoids a per-user lookup
	Frequency string
	LastRunAt *time.Time
	// Timezone + Schedule let the scheduler recompute the correct next_run_at in
	// Go after the SQL claim advances it by the legacy fixed interval.
	Timezone string
	Schedule DigestSchedule
}

// DigestPrefsRepository persists per-user digest preferences.
type DigestPrefsRepository interface {
	// Get returns the user's preference, defaulting to "off" when no row exists.
	Get(ctx context.Context, userID user.ID) (DigestPref, error)

	// Set stores the frequency, the granular schedule, and the computed next run
	// time (nil when off). The user's timezone lives on the users row and is
	// persisted separately via UserRepository.SetTimezone.
	Set(ctx context.Context, userID user.ID, frequency string, schedule DigestSchedule, nextRunAt *time.Time, now time.Time) error

	// ClaimDue atomically claims every due digest (next_run_at <= now, not off):
	// in one statement it advances each row's next_run_at by its frequency and
	// sets last_run_at = now, returning the claimed rows (with their prior
	// last_run_at, schedule, and timezone). Claiming before sending makes
	// delivery at-most-once, so a crash or overlapping run never double-sends.
	// The caller recomputes the precise next_run_at in Go and writes it back via
	// Reschedule.
	ClaimDue(ctx context.Context, now time.Time) ([]DueDigest, error)

	// Reschedule overwrites a claimed row's next_run_at with the schedule-aware
	// value computed in Go. Called right after ClaimDue, inside RunDue.
	Reschedule(ctx context.Context, userID user.ID, nextRunAt *time.Time, now time.Time) error

	// SetLoginAlerts stores whether the user receives sign-in alert emails.
	SetLoginAlerts(ctx context.Context, userID user.ID, enabled bool, now time.Time) error

	// LoginAlertsEnabled reports whether the user receives sign-in alert
	// emails, defaulting to true when no row exists.
	LoginAlertsEnabled(ctx context.Context, userID user.ID) (bool, error)
}

// DigestActivityReader aggregates a user's activity for the digest window.
type DigestActivityReader interface {
	// Summary counts activity since `since`; login items not updated since
	// `staleBefore` are counted as stale.
	Summary(ctx context.Context, userID user.ID, since, staleBefore time.Time) (DigestActivity, error)
}
