// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	dombackup "github.com/vineethkrishnan/vaultctl/internal/domain/backup"
	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

var (
	_ ports.BackupDestinationRepository = (*BackupDestinationRepo)(nil)
	_ ports.BackupRunRepository         = (*BackupRunRepo)(nil)
)

// BackupDestinationRepo persists backup destinations, sealing the provider
// settings (folder path, bucket, OAuth tokens) with the server data key before
// they touch the database.
type BackupDestinationRepo struct {
	Pool   *Pool
	Sealer ports.Sealer
}

func configAAD(destinationID string) []byte {
	return []byte("backup:config:" + destinationID)
}

func (r *BackupDestinationRepo) sealSettings(destinationID string, settings map[string]string) (string, error) {
	plaintext, err := json.Marshal(settings)
	if err != nil {
		return "", fmt.Errorf("marshal settings: %w", err)
	}
	blob, err := r.Sealer.Encrypt(plaintext, configAAD(destinationID))
	if err != nil {
		return "", fmt.Errorf("seal settings: %w", err)
	}
	return base64.StdEncoding.EncodeToString(blob.Bytes()), nil
}

func (r *BackupDestinationRepo) openSettings(destinationID, encoded string) (map[string]string, error) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode settings: %w", err)
	}
	blob, err := domaincrypto.ParseBlob(raw)
	if err != nil {
		return nil, err
	}
	plaintext, err := r.Sealer.Decrypt(blob, configAAD(destinationID))
	if err != nil {
		return nil, fmt.Errorf("open settings: %w", err)
	}
	out := map[string]string{}
	if err := json.Unmarshal(plaintext, &out); err != nil {
		return nil, fmt.Errorf("unmarshal settings: %w", err)
	}
	return out, nil
}

func (r *BackupDestinationRepo) Create(ctx context.Context, d dombackup.Destination) error {
	encrypted, err := r.sealSettings(d.ID, d.Settings)
	if err != nil {
		return err
	}
	_, err = r.Pool.Exec(ctx, `
		INSERT INTO backup_destinations
			(id, user_id, provider, label, encrypted_config, frequency,
			 retention_keep, enabled, next_run_at, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, d.ID, d.UserID, string(d.Provider), d.Label, encrypted, string(d.Frequency),
		d.RetentionKeep, d.Enabled, d.NextRunAt, d.CreatedAt, d.UpdatedAt)
	return err
}

func (r *BackupDestinationRepo) Update(ctx context.Context, d dombackup.Destination) error {
	encrypted, err := r.sealSettings(d.ID, d.Settings)
	if err != nil {
		return err
	}
	tag, err := r.Pool.Exec(ctx, `
		UPDATE backup_destinations
		SET provider=$2, label=$3, encrypted_config=$4, frequency=$5,
		    retention_keep=$6, enabled=$7, next_run_at=$8, updated_at=$9
		WHERE id=$1
	`, d.ID, string(d.Provider), d.Label, encrypted, string(d.Frequency),
		d.RetentionKeep, d.Enabled, d.NextRunAt, d.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

const backupDestColumns = `id, user_id, provider, label, encrypted_config, frequency,
	retention_keep, enabled, last_run_at, last_status, next_run_at, created_at, updated_at`

func (r *BackupDestinationRepo) Get(ctx context.Context, id string) (dombackup.Destination, error) {
	row := r.Pool.QueryRow(ctx, `SELECT `+backupDestColumns+` FROM backup_destinations WHERE id=$1`, id)
	return r.scan(row)
}

func (r *BackupDestinationRepo) ListForUser(ctx context.Context, userID string) ([]dombackup.Destination, error) {
	rows, err := r.Pool.Query(ctx, `SELECT `+backupDestColumns+`
		FROM backup_destinations WHERE user_id=$1 ORDER BY created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return r.scanAll(rows)
}

func (r *BackupDestinationRepo) ListDue(ctx context.Context, now time.Time) ([]dombackup.Destination, error) {
	rows, err := r.Pool.Query(ctx, `SELECT `+backupDestColumns+`
		FROM backup_destinations
		WHERE enabled AND frequency <> 'off' AND next_run_at IS NOT NULL AND next_run_at <= $1`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return r.scanAll(rows)
}

func (r *BackupDestinationRepo) MarkRun(ctx context.Context, id string, status dombackup.RunStatus, ranAt, nextRunAt time.Time) error {
	var next *time.Time
	if !nextRunAt.IsZero() {
		next = &nextRunAt
	}
	_, err := r.Pool.Exec(ctx, `
		UPDATE backup_destinations
		SET last_run_at=$2, last_status=$3, next_run_at=$4, updated_at=$2
		WHERE id=$1
	`, id, ranAt, string(status), next)
	return err
}

func (r *BackupDestinationRepo) UpdateSettings(ctx context.Context, id string, settings map[string]string) error {
	encrypted, err := r.sealSettings(id, settings)
	if err != nil {
		return err
	}
	_, err = r.Pool.Exec(ctx, `UPDATE backup_destinations SET encrypted_config=$2 WHERE id=$1`, id, encrypted)
	return err
}

func (r *BackupDestinationRepo) Delete(ctx context.Context, id string) error {
	_, err := r.Pool.Exec(ctx, `DELETE FROM backup_destinations WHERE id=$1`, id)
	return err
}

func (r *BackupDestinationRepo) scanAll(rows pgx.Rows) ([]dombackup.Destination, error) {
	var out []dombackup.Destination
	for rows.Next() {
		d, err := r.scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *BackupDestinationRepo) scan(row rowScanner) (dombackup.Destination, error) {
	var (
		d          dombackup.Destination
		provider   string
		frequency  string
		encrypted  string
		lastRunAt  *time.Time
		lastStatus *string
		nextRunAt  *time.Time
	)
	err := row.Scan(&d.ID, &d.UserID, &provider, &d.Label, &encrypted, &frequency,
		&d.RetentionKeep, &d.Enabled, &lastRunAt, &lastStatus, &nextRunAt, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return dombackup.Destination{}, domain.ErrNotFound
		}
		return dombackup.Destination{}, err
	}
	d.Provider = dombackup.Provider(provider)
	d.Frequency = dombackup.Frequency(frequency)
	d.LastRunAt = lastRunAt
	d.NextRunAt = nextRunAt
	if lastStatus != nil {
		d.LastStatus = dombackup.RunStatus(*lastStatus)
	}
	settings, err := r.openSettings(d.ID, encrypted)
	if err != nil {
		return dombackup.Destination{}, err
	}
	d.Settings = settings
	return d, nil
}

// BackupRunRepo records the history of backup runs.
type BackupRunRepo struct{ Pool *Pool }

func (r *BackupRunRepo) Create(ctx context.Context, run dombackup.Run) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO backup_runs
			(id, destination_id, status, trigger, artifact_name, size_bytes, error, started_at, finished_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, run.ID, run.DestinationID, string(run.Status), string(run.Trigger),
		nullIfEmpty(run.ArtifactName), run.SizeBytes, nullIfEmpty(run.Error), run.StartedAt, run.FinishedAt)
	return err
}

func (r *BackupRunRepo) ListForDestination(ctx context.Context, destinationID string, limit int) ([]dombackup.Run, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT id, destination_id, status, trigger, artifact_name, size_bytes, error, started_at, finished_at
		FROM backup_runs WHERE destination_id=$1 ORDER BY started_at DESC LIMIT $2
	`, destinationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []dombackup.Run
	for rows.Next() {
		var (
			run          dombackup.Run
			status       string
			trigger      string
			artifactName *string
			errMsg       *string
		)
		if err := rows.Scan(&run.ID, &run.DestinationID, &status, &trigger,
			&artifactName, &run.SizeBytes, &errMsg, &run.StartedAt, &run.FinishedAt); err != nil {
			return nil, err
		}
		run.Status = dombackup.RunStatus(status)
		run.Trigger = dombackup.Trigger(trigger)
		if artifactName != nil {
			run.ArtifactName = *artifactName
		}
		if errMsg != nil {
			run.Error = *errMsg
		}
		out = append(out, run)
	}
	return out, rows.Err()
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
