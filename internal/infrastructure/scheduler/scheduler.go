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
	trashPurgeSchedule    = "0 3 * * *"    // daily at 3 AM
	sessionPurgeSchedule  = "0 * * * *"    // every hour
	backupSchedule        = "*/15 * * * *" // every 15 minutes: scan for due backups
	updateRefreshSchedule = "*/15 * * * *" // every 15 minutes: refresh the release cache
	jobTimeout            = 30 * time.Second
	backupJobTimeout      = 10 * time.Minute
)

// Scheduler runs periodic maintenance tasks.
type Scheduler struct {
	cron               *cron.Cron
	items              ports.ItemRepository
	sessions           ports.SessionStore
	clock              ports.Clock
	trashRetentionDays int

	// Optional per-user backup driver, enabled via EnableBackups. Kept as a
	// closure so the scheduler stays dependent only on ports.
	backupDests ports.BackupDestinationRepository
	runBackup   func(ctx context.Context, destinationID string) error

	// Optional release-cache refresh, enabled via EnableUpdateRefresh. A closure
	// so the scheduler doesn't depend on the updatecheck package.
	refreshUpdate func(ctx context.Context) error
}

// EnableUpdateRefresh wires periodic refresh of the update-check cache so a new
// release is detected within one interval even without client traffic. No-op
// unless called before Start.
func (s *Scheduler) EnableUpdateRefresh(refresh func(ctx context.Context) error) {
	s.refreshUpdate = refresh
}

// EnableBackups wires the due-backup scan into the scheduler. run executes one
// backup for a destination ID (the caller binds it to the RunBackup use case
// with a scheduled trigger). No-op unless called before Start.
func (s *Scheduler) EnableBackups(dests ports.BackupDestinationRepository, run func(ctx context.Context, destinationID string) error) {
	s.backupDests = dests
	s.runBackup = run
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
	if s.runBackup != nil {
		if _, err := s.cron.AddFunc(backupSchedule, s.runDueBackups); err != nil {
			slog.Error("scheduler.register_backups.failed", slog.String("err", err.Error()))
		}
	}
	if s.refreshUpdate != nil {
		if _, err := s.cron.AddFunc(updateRefreshSchedule, s.refreshUpdateCheck); err != nil {
			slog.Error("scheduler.register_update_refresh.failed", slog.String("err", err.Error()))
		}
		go s.refreshUpdateCheck() // warm the cache on boot rather than waiting a full interval
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

func (s *Scheduler) runDueBackups() {
	ctx, cancel := context.WithTimeout(context.Background(), backupJobTimeout)
	defer cancel()

	due, err := s.backupDests.ListDue(ctx, s.clock.Now())
	if err != nil {
		slog.Error("scheduler.backups.list_due.failed", slog.String("err", err.Error()))
		return
	}
	ran := 0
	for _, dest := range due {
		if err := s.runBackup(ctx, dest.ID); err != nil {
			slog.Error("scheduler.backups.run.failed",
				slog.String("destination_id", dest.ID), slog.String("err", err.Error()))
			continue
		}
		ran++
	}
	if ran > 0 {
		slog.Info("scheduler.backups.done", slog.Int("ran", ran))
	}
}

func (s *Scheduler) refreshUpdateCheck() {
	ctx, cancel := context.WithTimeout(context.Background(), jobTimeout)
	defer cancel()

	if err := s.refreshUpdate(ctx); err != nil {
		slog.Warn("scheduler.update_refresh.failed", slog.String("err", err.Error()))
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
