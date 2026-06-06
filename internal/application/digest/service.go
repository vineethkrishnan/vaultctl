// SPDX-License-Identifier: AGPL-3.0-or-later

package digest

import (
	"context"
	"log/slog"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// staleAfterMonths is how long a login item can go unchanged before the digest
// nudges the user to review it.
const staleAfterMonths = 12

// Sender delivers a rendered digest. *email.Service satisfies it.
type Sender interface {
	SendDigest(ctx context.Context, to, period string, a ports.DigestActivity) error
}

// Service runs due digests.
type Service struct {
	Prefs    ports.DigestPrefsRepository
	Activity ports.DigestActivityReader
	Sender   Sender
	Clock    ports.Clock
}

// Frequency returns a user's current digest frequency (Off when unset).
func (s *Service) Frequency(ctx context.Context, userID user.ID) (Frequency, error) {
	p, err := s.Prefs.Get(ctx, userID)
	if err != nil {
		return Off, err
	}
	if p.Frequency == "" {
		return Off, nil
	}
	return Frequency(p.Frequency), nil
}

// SetFrequency validates and stores a user's preference, computing the next run.
func (s *Service) SetFrequency(ctx context.Context, userID user.ID, freq Frequency) error {
	now := s.Clock.Now()
	var nextRun *time.Time
	if next, ok := freq.NextRun(now); ok {
		nextRun = &next
	}
	return s.Prefs.Set(ctx, userID, string(freq), nextRun, now)
}

// LoginAlerts reports whether the user receives sign-in alert emails.
func (s *Service) LoginAlerts(ctx context.Context, userID user.ID) (bool, error) {
	return s.Prefs.LoginAlertsEnabled(ctx, userID)
}

// SetLoginAlerts stores whether the user receives sign-in alert emails.
func (s *Service) SetLoginAlerts(ctx context.Context, userID user.ID, enabled bool) error {
	return s.Prefs.SetLoginAlerts(ctx, userID, enabled, s.Clock.Now())
}

// RunDue sends every digest that is due. ClaimDue advances the schedule before
// any send (at-most-once), so a per-user send failure is logged and skipped
// rather than retried, and a crash never double-sends. One bad send doesn't
// stall the rest.
func (s *Service) RunDue(ctx context.Context) error {
	now := s.Clock.Now()
	due, err := s.Prefs.ClaimDue(ctx, now)
	if err != nil {
		return err
	}
	staleBefore := now.AddDate(0, -staleAfterMonths, 0)

	for _, d := range due {
		freq := Frequency(d.Frequency)
		since := now.Add(-freq.Window())
		if d.LastRunAt != nil && d.LastRunAt.After(since) {
			since = *d.LastRunAt
		}

		summary, err := s.Activity.Summary(ctx, d.UserID, since, staleBefore)
		if err != nil {
			slog.WarnContext(ctx, "digest.summary.failed", slog.String("user_id", string(d.UserID)), slog.String("err", err.Error()))
			continue
		}

		// Nothing happened: the row is already rescheduled by the claim.
		if summary.Empty() {
			continue
		}
		if err := s.Sender.SendDigest(ctx, d.Email, freq.Label(), summary); err != nil {
			slog.WarnContext(ctx, "digest.send.failed", slog.String("user_id", string(d.UserID)), slog.String("err", err.Error()))
		}
	}
	return nil
}
