// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"sort"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	dombackup "github.com/vineethkrishnan/vaultctl/internal/domain/backup"
)

// ConfigureDestinationInput creates or updates a user's backup destination.
// An empty ID creates; a present ID updates the caller's existing destination.
type ConfigureDestinationInput struct {
	Caller        string
	ID            string
	Provider      string
	Label         string
	Settings      map[string]string
	Frequency     string
	RetentionKeep int
	Enabled       bool
}

// ConfigureDestination persists a backup destination for the caller.
type ConfigureDestination struct {
	Destinations ports.BackupDestinationRepository
	Clock        ports.Clock
	IDs          ports.IDGenerator
}

// Execute validates the input and creates or updates the destination.
func (uc *ConfigureDestination) Execute(ctx context.Context, in ConfigureDestinationInput) (dombackup.Destination, error) {
	if in.Caller == "" {
		return dombackup.Destination{}, domain.NewInvalid("caller", "required")
	}
	provider, err := dombackup.ParseProvider(in.Provider)
	if err != nil {
		return dombackup.Destination{}, err
	}
	frequency, err := dombackup.ParseFrequency(in.Frequency)
	if err != nil {
		return dombackup.Destination{}, err
	}
	now := uc.Clock.Now()

	dest := dombackup.Destination{
		UserID:        in.Caller,
		Provider:      provider,
		Label:         in.Label,
		Settings:      in.Settings,
		Frequency:     frequency,
		RetentionKeep: in.RetentionKeep,
		Enabled:       in.Enabled,
		UpdatedAt:     now,
	}
	if next := frequency.Next(now); !next.IsZero() && in.Enabled {
		dest.NextRunAt = &next
	}
	if err := dest.Validate(); err != nil {
		return dombackup.Destination{}, err
	}

	if in.ID == "" {
		dest.ID = uc.IDs.NewID()
		dest.CreatedAt = now
		if err := uc.Destinations.Create(ctx, dest); err != nil {
			return dombackup.Destination{}, fmt.Errorf("create destination: %w", err)
		}
		return dest, nil
	}

	existing, err := uc.Destinations.Get(ctx, in.ID)
	if err != nil {
		return dombackup.Destination{}, err
	}
	if existing.UserID != in.Caller {
		return dombackup.Destination{}, domain.ErrNotFound
	}
	dest.ID = existing.ID
	dest.CreatedAt = existing.CreatedAt
	// When settings are omitted on update, keep the stored (sealed) ones so a
	// re-save from the UI doesn't wipe credentials it never received.
	if len(dest.Settings) == 0 {
		dest.Settings = existing.Settings
	}
	if err := uc.Destinations.Update(ctx, dest); err != nil {
		return dombackup.Destination{}, fmt.Errorf("update destination: %w", err)
	}
	return dest, nil
}

// ListDestinations returns the caller's destinations.
type ListDestinations struct {
	Destinations ports.BackupDestinationRepository
}

// Execute lists destinations for a user.
func (uc *ListDestinations) Execute(ctx context.Context, caller string) ([]dombackup.Destination, error) {
	return uc.Destinations.ListForUser(ctx, caller)
}

// DeleteDestination removes a caller-owned destination.
type DeleteDestination struct {
	Destinations ports.BackupDestinationRepository
}

// Execute deletes the destination after an ownership check.
func (uc *DeleteDestination) Execute(ctx context.Context, caller, id string) error {
	dest, err := uc.Destinations.Get(ctx, id)
	if err != nil {
		return err
	}
	if dest.UserID != caller {
		return domain.ErrNotFound
	}
	return uc.Destinations.Delete(ctx, id)
}

// RunBackupInput identifies the destination to back up and what triggered it.
// Caller is the requesting user for the manual path (ownership-checked); the
// scheduler leaves it empty to run as the system.
type RunBackupInput struct {
	Caller        string
	DestinationID string
	Trigger       dombackup.Trigger
}

// RunBackup produces the caller's sealed encrypted export and stores it at the
// destination, prunes to the retention limit, and records the run. It is used
// both by the manual "Back up now" path and by the scheduler.
type RunBackup struct {
	Destinations ports.BackupDestinationRepository
	Runs         ports.BackupRunRepository
	Stores       ports.BackupStoreFactory
	Exporter     ports.Exporter
	Sealer       ports.Sealer
	Clock        ports.Clock
	IDs          ports.IDGenerator
}

// Execute runs one backup for the destination.
func (uc *RunBackup) Execute(ctx context.Context, in RunBackupInput) (dombackup.Run, error) {
	dest, err := uc.Destinations.Get(ctx, in.DestinationID)
	if err != nil {
		return dombackup.Run{}, err
	}
	if in.Caller != "" && dest.UserID != in.Caller {
		return dombackup.Run{}, domain.ErrNotFound
	}
	started := uc.Clock.Now()
	run := dombackup.Run{
		ID:            uc.IDs.NewID(),
		DestinationID: dest.ID,
		Trigger:       in.Trigger,
		StartedAt:     started,
	}

	name, size, runErr := uc.execute(ctx, dest)
	finished := uc.Clock.Now()
	run.FinishedAt = &finished
	run.ArtifactName = name
	run.SizeBytes = size
	if runErr != nil {
		run.Status = dombackup.StatusFailed
		run.Error = runErr.Error()
	} else {
		run.Status = dombackup.StatusSuccess
	}

	if err := uc.Runs.Create(ctx, run); err != nil {
		return run, fmt.Errorf("record run: %w", err)
	}
	var nextRun time.Time
	if next := dest.Frequency.Next(finished); !next.IsZero() && dest.Enabled {
		nextRun = next
	}
	if err := uc.Destinations.MarkRun(ctx, dest.ID, run.Status, finished, nextRun); err != nil {
		return run, fmt.Errorf("mark run: %w", err)
	}
	return run, runErr
}

func (uc *RunBackup) execute(ctx context.Context, dest dombackup.Destination) (string, int64, error) {
	store, err := uc.Stores.For(dest)
	if err != nil {
		return "", 0, err
	}
	payload, err := uc.Exporter.ExportEncrypted(ctx, dest.UserID)
	if err != nil {
		return "", 0, fmt.Errorf("export: %w", err)
	}
	sealed, err := sealArtifact(uc.Sealer, dest.ID, payload)
	if err != nil {
		return "", 0, err
	}
	name := artifactName(uc.Clock.Now())
	if err := store.Put(ctx, name, bytes.NewReader(sealed), int64(len(sealed))); err != nil {
		return "", 0, fmt.Errorf("store artifact: %w", err)
	}
	uc.prune(ctx, store, dest.RetentionKeep)
	return name, int64(len(sealed)), nil
}

// prune deletes artifacts beyond the retention limit, newest kept. Failures
// are non-fatal: the fresh backup is already safely stored.
func (uc *RunBackup) prune(ctx context.Context, store ports.BackupStore, keep int) {
	if keep < 1 {
		return
	}
	objects, err := store.List(ctx)
	if err != nil {
		return
	}
	sort.Slice(objects, func(i, j int) bool { return objects[i].ModTime.After(objects[j].ModTime) })
	for _, obj := range objects[min(keep, len(objects)):] {
		_ = store.Delete(ctx, obj.Name)
	}
}

// ListRunsInput identifies the destination whose runs to list.
type ListRunsInput struct {
	Caller        string
	DestinationID string
	Limit         int
}

// ListRuns returns recent runs for a caller-owned destination.
type ListRuns struct {
	Destinations ports.BackupDestinationRepository
	Runs         ports.BackupRunRepository
}

// Execute lists runs after an ownership check.
func (uc *ListRuns) Execute(ctx context.Context, in ListRunsInput) ([]dombackup.Run, error) {
	dest, err := uc.Destinations.Get(ctx, in.DestinationID)
	if err != nil {
		return nil, err
	}
	if dest.UserID != in.Caller {
		return nil, domain.ErrNotFound
	}
	limit := in.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return uc.Runs.ListForDestination(ctx, in.DestinationID, limit)
}

// ListArtifacts returns the stored artifacts at a caller-owned destination so
// the user can pick one to restore.
type ListArtifacts struct {
	Destinations ports.BackupDestinationRepository
	Stores       ports.BackupStoreFactory
}

// Execute lists artifacts after an ownership check.
func (uc *ListArtifacts) Execute(ctx context.Context, caller, destinationID string) ([]ports.StoredObject, error) {
	dest, err := uc.Destinations.Get(ctx, destinationID)
	if err != nil {
		return nil, err
	}
	if dest.UserID != caller {
		return nil, domain.ErrNotFound
	}
	store, err := uc.Stores.For(dest)
	if err != nil {
		return nil, err
	}
	return store.List(ctx)
}

// RestoreInput identifies the artifact to restore from a caller-owned
// destination.
type RestoreInput struct {
	Caller        string
	DestinationID string
	ArtifactName  string
}

// Restore fetches a stored artifact and unseals the server layer, returning the
// user's client-encrypted export bytes. The client decrypts and re-imports it
// with the master password; the server never sees plaintext.
type Restore struct {
	Destinations ports.BackupDestinationRepository
	Stores       ports.BackupStoreFactory
	Sealer       ports.Sealer
}

// Execute returns the client-encrypted export payload for the named artifact.
func (uc *Restore) Execute(ctx context.Context, in RestoreInput) ([]byte, error) {
	dest, err := uc.Destinations.Get(ctx, in.DestinationID)
	if err != nil {
		return nil, err
	}
	if dest.UserID != in.Caller {
		return nil, domain.ErrNotFound
	}
	store, err := uc.Stores.For(dest)
	if err != nil {
		return nil, err
	}
	rc, err := store.Get(ctx, in.ArtifactName)
	if err != nil {
		return nil, fmt.Errorf("fetch artifact: %w", err)
	}
	defer rc.Close()
	sealed, err := io.ReadAll(rc)
	if err != nil {
		return nil, fmt.Errorf("read artifact: %w", err)
	}
	return openArtifact(uc.Sealer, dest.ID, sealed)
}
