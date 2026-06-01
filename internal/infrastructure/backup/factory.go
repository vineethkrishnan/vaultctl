// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"errors"
	"fmt"
	"path/filepath"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	dombackup "github.com/vineethkrishnan/vaultctl/internal/domain/backup"
)

// ErrProviderUnavailable is returned when a destination names a provider whose
// backend is not yet wired (e.g. a cloud provider without configured OAuth
// credentials). Handlers map this to a clear "connect/configure first" error.
var ErrProviderUnavailable = errors.New("backup: provider not available")

var _ ports.BackupStoreFactory = (*StoreFactory)(nil)

// StoreFactory builds the concrete BackupStore for a destination. Local is
// always available; cloud providers are added as their adapters land.
type StoreFactory struct {
	// LocalBaseDir roots every local destination; each gets its own subdir
	// keyed by destination ID.
	LocalBaseDir string
}

// For returns the store for dest based on its provider and decrypted settings.
func (f *StoreFactory) For(dest dombackup.Destination) (ports.BackupStore, error) {
	switch dest.Provider {
	case dombackup.ProviderLocal:
		dir := dest.Settings["dir"]
		if dir == "" {
			dir = filepath.Join(f.LocalBaseDir, dest.ID)
		}
		return NewLocalStore(dir)
	case dombackup.ProviderS3, dombackup.ProviderWebDAV,
		dombackup.ProviderGoogleDrive, dombackup.ProviderDropbox, dombackup.ProviderOneDrive:
		return nil, fmt.Errorf("%w: %s", ErrProviderUnavailable, dest.Provider)
	default:
		return nil, fmt.Errorf("%w: unknown provider %s", ErrProviderUnavailable, dest.Provider)
	}
}
