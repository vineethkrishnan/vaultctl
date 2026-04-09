package scheduler

import (
	"context"
	"log/slog"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

// Scheduler runs periodic maintenance tasks.
type Scheduler struct {
	cron               *cron.Cron
	items              ports.ItemRepository
	sessions           ports.SessionStore
	trashRetentionDays int
}

// New creates a scheduler with the given repositories.
func New(items ports.ItemRepository, sessions ports.SessionStore, trashRetentionDays int) *Scheduler {
	return &Scheduler{
		cron:               cron.New(),
		items:              items,
		sessions:           sessions,
		trashRetentionDays: trashRetentionDays,
	}
}

// Start registers and starts all cron jobs.
func (s *Scheduler) Start() {
	// Purge expired trash items daily at 3 AM
	s.cron.AddFunc("0 3 * * *", s.purgeTrash)

	// Purge expired sessions every hour
	s.cron.AddFunc("0 * * * *", s.purgeSessions)

	s.cron.Start()
	slog.Info("scheduler.started", slog.Int("jobs", len(s.cron.Entries())))
}

// Stop gracefully shuts down the scheduler.
func (s *Scheduler) Stop() context.Context {
	return s.cron.Stop()
}

func (s *Scheduler) purgeTrash() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cutoff := time.Now().AddDate(0, 0, -s.trashRetentionDays)
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
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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
