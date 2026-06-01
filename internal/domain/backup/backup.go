// SPDX-License-Identifier: AGPL-3.0-or-later

// Package backup carries the value objects for scheduled, per-user encrypted
// vault backups. The artifact a destination stores is the user's client-side
// encrypted export (ciphertext only) sealed again with the server data key
// before it leaves the box, so a destination never holds plaintext.
package backup

import (
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
)

// Provider identifies a storage backend a destination writes to.
type Provider string

const (
	ProviderLocal       Provider = "local"
	ProviderS3          Provider = "s3"
	ProviderWebDAV      Provider = "webdav"
	ProviderGoogleDrive Provider = "gdrive"
	ProviderDropbox     Provider = "dropbox"
	ProviderOneDrive    Provider = "onedrive"
)

// ParseProvider validates a provider string.
func ParseProvider(s string) (Provider, error) {
	switch Provider(s) {
	case ProviderLocal, ProviderS3, ProviderWebDAV, ProviderGoogleDrive, ProviderDropbox, ProviderOneDrive:
		return Provider(s), nil
	default:
		return "", fmt.Errorf("%w: unknown backup provider %q", domain.ErrInvalid, s)
	}
}

// Frequency is how often the scheduler runs a destination.
type Frequency string

const (
	FrequencyOff    Frequency = "off"
	FrequencyDaily  Frequency = "daily"
	FrequencyWeekly Frequency = "weekly"
)

// ParseFrequency validates a frequency string.
func ParseFrequency(s string) (Frequency, error) {
	switch Frequency(s) {
	case FrequencyOff, FrequencyDaily, FrequencyWeekly:
		return Frequency(s), nil
	default:
		return "", fmt.Errorf("%w: unknown backup frequency %q", domain.ErrInvalid, s)
	}
}

// Next returns the next run time after `from` for this frequency, or the zero
// time when the frequency is off (never auto-runs).
func (f Frequency) Next(from time.Time) time.Time {
	switch f {
	case FrequencyDaily:
		return from.AddDate(0, 0, 1)
	case FrequencyWeekly:
		return from.AddDate(0, 0, 7)
	default:
		return time.Time{}
	}
}

// RunStatus is the outcome of a backup run.
type RunStatus string

const (
	StatusSuccess RunStatus = "success"
	StatusFailed  RunStatus = "failed"
)

// Trigger records what initiated a run.
type Trigger string

const (
	TriggerScheduled Trigger = "scheduled"
	TriggerManual    Trigger = "manual"
)

// Destination is a configured backup target for one user. Settings holds the
// decrypted provider-specific configuration (folder path, bucket, OAuth
// tokens); the repository seals it before persistence and never logs it.
type Destination struct {
	ID            string
	UserID        string
	Provider      Provider
	Label         string
	Settings      map[string]string
	Frequency     Frequency
	RetentionKeep int
	Enabled       bool
	LastRunAt     *time.Time
	LastStatus    RunStatus
	NextRunAt     *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// Validate asserts the destination is well-formed before persistence.
func (d Destination) Validate() error {
	if _, err := ParseProvider(string(d.Provider)); err != nil {
		return err
	}
	if _, err := ParseFrequency(string(d.Frequency)); err != nil {
		return err
	}
	if d.Label == "" {
		return fmt.Errorf("%w: backup label is required", domain.ErrInvalid)
	}
	if d.RetentionKeep < 1 {
		return fmt.Errorf("%w: retention must keep at least 1 backup", domain.ErrInvalid)
	}
	return nil
}

// Run is one execution of a destination's backup.
type Run struct {
	ID            string
	DestinationID string
	Status        RunStatus
	Trigger       Trigger
	ArtifactName  string
	SizeBytes     int64
	Error         string
	StartedAt     time.Time
	FinishedAt    *time.Time
}
