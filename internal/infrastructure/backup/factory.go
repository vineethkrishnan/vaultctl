// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	dombackup "github.com/vineethkrishnan/vaultctl/internal/domain/backup"
)

// ErrProviderUnavailable is returned when a destination names a provider whose
// backend is not configured (e.g. a cloud provider without configured OAuth
// credentials). Handlers map this to a clear "connect/configure first" error.
var ErrProviderUnavailable = errors.New("backup: provider not available")

// ErrNotConnected is returned when an OAuth destination has no stored refresh
// token (it was never connected, or the connection was revoked).
var ErrNotConnected = errors.New("backup: destination is not connected")

var _ ports.BackupStoreFactory = (*StoreFactory)(nil)

// OAuthClient holds one provider's configured OAuth client credentials.
type OAuthClient struct {
	ClientID     string
	ClientSecret string
}

// StoreFactory builds the concrete BackupStore for a destination. Local,
// WebDAV and S3 are credential-based; the cloud providers refresh an OAuth
// access token from the stored refresh token at construction.
type StoreFactory struct {
	LocalBaseDir string
	HTTPClient   *http.Client
	Clock        func() time.Time

	// OAuthClients holds configured OAuth client credentials per provider;
	// absent entries disable that provider (For returns ErrProviderUnavailable).
	OAuthClients map[dombackup.Provider]OAuthClient

	// Persist saves rotated provider settings (e.g. a refreshed refresh token)
	// back to the destination. Optional; when nil, rotation is not persisted.
	Persist func(ctx context.Context, destinationID string, settings map[string]string) error
}

func (f *StoreFactory) httpClient() *http.Client {
	if f.HTTPClient != nil {
		return f.HTTPClient
	}
	return http.DefaultClient
}

func (f *StoreFactory) clock() time.Time {
	if f.Clock != nil {
		return f.Clock()
	}
	return time.Now()
}

// For returns the store for dest based on its provider and decrypted settings.
func (f *StoreFactory) For(ctx context.Context, dest dombackup.Destination) (ports.BackupStore, error) {
	switch dest.Provider {
	case dombackup.ProviderLocal:
		if f.LocalBaseDir == "" {
			return nil, fmt.Errorf("%w: local backups are not configured", ErrProviderUnavailable)
		}
		// Pin the path under the server-configured base, keyed by the
		// server-generated user and destination IDs. A user-supplied directory
		// is never honored - it would be an arbitrary server-side write.
		dir := filepath.Join(f.LocalBaseDir, dest.UserID, dest.ID)
		return NewLocalStore(dir)
	case dombackup.ProviderWebDAV:
		return NewWebDAVStore(f.httpClient(), dest.Settings)
	case dombackup.ProviderS3:
		return NewS3Store(f.httpClient(), dest.Settings, f.clock)
	case dombackup.ProviderGoogleDrive, dombackup.ProviderDropbox, dombackup.ProviderOneDrive:
		return f.oauthStore(ctx, dest)
	default:
		return nil, fmt.Errorf("%w: unknown provider %s", ErrProviderUnavailable, dest.Provider)
	}
}

func (f *StoreFactory) oauthStore(ctx context.Context, dest dombackup.Destination) (ports.BackupStore, error) {
	creds, ok := f.OAuthClients[dest.Provider]
	if !ok {
		return nil, fmt.Errorf("%w: %s (no OAuth client configured)", ErrProviderUnavailable, dest.Provider)
	}
	cfg, ok := OAuthProviderConfig(dest.Provider, creds.ClientID, creds.ClientSecret)
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrProviderUnavailable, dest.Provider)
	}
	refresh := dest.Settings["refresh_token"]
	if refresh == "" {
		return nil, ErrNotConnected
	}
	tok, err := cfg.Refresh(ctx, f.httpClient(), refresh, f.clock())
	if err != nil {
		return nil, err
	}
	// Persist a rotated refresh token (Microsoft rotates on every refresh).
	if tok.RefreshToken != refresh && f.Persist != nil {
		updated := map[string]string{}
		for k, v := range dest.Settings {
			updated[k] = v
		}
		updated["refresh_token"] = tok.RefreshToken
		_ = f.Persist(ctx, dest.ID, updated)
	}
	switch dest.Provider {
	case dombackup.ProviderGoogleDrive:
		return NewGoogleDriveStore(f.httpClient(), tok.AccessToken), nil
	case dombackup.ProviderDropbox:
		return NewDropboxStore(f.httpClient(), tok.AccessToken), nil
	case dombackup.ProviderOneDrive:
		return NewOneDriveStore(f.httpClient(), tok.AccessToken), nil
	default:
		return nil, fmt.Errorf("%w: %s", ErrProviderUnavailable, dest.Provider)
	}
}
