// SPDX-License-Identifier: AGPL-3.0-or-later

package scheduler

import (
	"context"
	"log/slog"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

const (
	trashPurgeSchedule   = "0 3 * * *" // daily at 3 AM
	sessionPurgeSchedule = "0 * * * *"  // every hour
	jobTimeout           = 30 * time.Second
)

// Scheduler runs periodic maintenance tasks.
type Scheduler struct {
	cron               *cron.Cron
	items              ports.ItemRepository
	sessions           ports.SessionStore
	clock              ports.Clock
	trashRetentionDays int
}

// New creates a scheduler with the given repositories.
func New(items ports.ItemRepository, sessions ports.SessionStore, clock ports.Clock, trashRetentionDays int) *Scheduler {
	return &Scheduler{
		cron:               cron.New(),
		items:              items,
		sessions:           sessions,
		clock:              clock,
		trashRetentionDays: trashRetentionDays,
	}
}

// Start registers and starts all cron jobs.
func (s *Scheduler) Start() {
	if _, err := s.cron.AddFunc(trashPurgeSchedule, s.purgeTrash); err != nil {
		slog.Error("scheduler.register_trash_purge.failed", slog.String("err", err.Error()))
	}
	if _, err := s.cron.AddFunc(sessionPurgeSchedule, s.purgeSessions); err != nil {
		slog.Error("scheduler.register_session_purge.failed", slog.String("err", err.Error()))
	}

	s.cron.Start()
	slog.Info("scheduler.started", slog.Int("jobs", len(s.cron.Entries())))
}

// Stop gracefully shuts down the scheduler.
func (s *Scheduler) Stop() context.Context {
	return s.cron.Stop()
}

func (s *Scheduler) purgeTrash() {
	ctx, cancel := context.WithTimeout(context.Background(), jobTimeout)
	defer cancel()

	cutoff := s.clock.Now().AddDate(0, 0, -s.trashRetentionDays)
	n, err := s.items.PurgeExpired(ctx, cutoff)
	if err != nil {
		slog.Error("scheduler.purge_trash.failed", slog.String("err", err.Error()))
		return
	}
	if n > 0 {
		slog.Info("scheduler.purge_trash.done", slog.Int("purged", n))
	}
}

func (s *Scheduler) purgeSessions() {
	ctx, cancel := context.WithTimeout(context.Background(), jobTimeout)
	defer cancel()

	n, err := s.sessions.PurgeExpired(ctx)
	if err != nil {
		slog.Error("scheduler.purge_sessions.failed", slog.String("err", err.Error()))
		return
	}
	if n > 0 {
		slog.Info("scheduler.purge_sessions.done", slog.Int("purged", n))
	}
}
