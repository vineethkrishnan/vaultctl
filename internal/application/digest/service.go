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

// RunDue sends every digest that is due. Per-user failures are logged and
// skipped so one bad send doesn't stall the rest.
func (s *Service) RunDue(ctx context.Context) error {
	now := s.Clock.Now()
	due, err := s.Prefs.ListDue(ctx, now)
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

		// Don't email "nothing happened"; just reschedule.
		if !summary.Empty() {
			if err := s.Sender.SendDigest(ctx, d.Email, freq.Label(), summary); err != nil {
				slog.WarnContext(ctx, "digest.send.failed", slog.String("user_id", string(d.UserID)), slog.String("err", err.Error()))
				continue
			}
		}

		var nextRun *time.Time
		if next, ok := freq.NextRun(now); ok {
			nextRun = &next
		}
		if err := s.Prefs.MarkRun(ctx, d.UserID, now, nextRun); err != nil {
			slog.WarnContext(ctx, "digest.mark_run.failed", slog.String("user_id", string(d.UserID)), slog.String("err", err.Error()))
		}
	}
	return nil
}
