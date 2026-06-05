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

// DigestPref is a user's stored digest preference.
type DigestPref struct {
	Frequency string
	NextRunAt *time.Time
	LastRunAt *time.Time
}

// DueDigest identifies a user whose digest is ready to send.
type DueDigest struct {
	UserID    user.ID
	Email     string
	Frequency string
	LastRunAt *time.Time
}

// DigestPrefsRepository persists per-user digest preferences.
type DigestPrefsRepository interface {
	// Get returns the user's preference, defaulting to "off" when no row exists.
	Get(ctx context.Context, userID user.ID) (DigestPref, error)

	// Set stores the frequency and the computed next run time (nil when off).
	Set(ctx context.Context, userID user.ID, frequency string, nextRunAt *time.Time, now time.Time) error

	// ListDue returns users whose digest is due (next_run_at <= now, not off),
	// joined to their email.
	ListDue(ctx context.Context, now time.Time) ([]DueDigest, error)

	// MarkRun records a completed send and schedules the next one.
	MarkRun(ctx context.Context, userID user.ID, lastRunAt time.Time, nextRunAt *time.Time) error
}

// DigestActivityReader aggregates a user's activity for the digest window.
type DigestActivityReader interface {
	// Summary counts activity since `since`; login items not updated since
	// `staleBefore` are counted as stale.
	Summary(ctx context.Context, userID user.ID, since, staleBefore time.Time) (DigestActivity, error)
}
