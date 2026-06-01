// SPDX-License-Identifier: AGPL-3.0-or-later

package ports

import (
	"context"
	"io"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/backup"
	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// Sealer seals/opens bytes with the server data key (AES-256-GCM). The
// infrastructure ServerAEAD satisfies it. Used to seal a backup artifact and
// to seal provider credentials at rest.
type Sealer interface {
	Encrypt(plaintext, aad []byte) (domaincrypto.EncryptedBlob, error)
	Decrypt(blob domaincrypto.EncryptedBlob, aad []byte) ([]byte, error)
}

// StoredObject is one artifact found in a backup destination.
type StoredObject struct {
	Name    string
	Size    int64
	ModTime time.Time
}

// BackupStore is the storage backend a destination writes its sealed artifacts
// to. Implementations exist per provider (local dir, S3, WebDAV, Google Drive,
// Dropbox, OneDrive); they handle only opaque bytes under a name and never see
// plaintext. Names are server-generated; implementations MUST reject names that
// could escape their namespace.
type BackupStore interface {
	Put(ctx context.Context, name string, r io.Reader, size int64) error
	List(ctx context.Context) ([]StoredObject, error)
	Get(ctx context.Context, name string) (io.ReadCloser, error)
	Delete(ctx context.Context, name string) error
}

// BackupStoreFactory builds the concrete store for a destination from its
// decrypted settings. Kept separate from the repository so the scheduler and
// handlers share one construction path.
type BackupStoreFactory interface {
	For(ctx context.Context, dest backup.Destination) (BackupStore, error)
}

// BackupDestinationRepository persists per-user backup destinations. The repo
// owns sealing/unsealing of Destination.Settings with the server data key.
type BackupDestinationRepository interface {
	Create(ctx context.Context, dest backup.Destination) error
	Update(ctx context.Context, dest backup.Destination) error
	Get(ctx context.Context, id string) (backup.Destination, error)
	ListForUser(ctx context.Context, userID string) ([]backup.Destination, error)
	// ListDue returns enabled, non-off destinations whose NextRunAt is at or
	// before now, for the scheduler to execute.
	ListDue(ctx context.Context, now time.Time) ([]backup.Destination, error)
	// MarkRun records the outcome of a run and advances NextRunAt.
	MarkRun(ctx context.Context, id string, status backup.RunStatus, ranAt, nextRunAt time.Time) error
	// UpdateSettings reseals and replaces only the provider settings, used when
	// an OAuth provider rotates its refresh token mid-run.
	UpdateSettings(ctx context.Context, id string, settings map[string]string) error
	Delete(ctx context.Context, id string) error
}

// BackupRunRepository records the history of backup runs.
type BackupRunRepository interface {
	Create(ctx context.Context, run backup.Run) error
	ListForDestination(ctx context.Context, destinationID string, limit int) ([]backup.Run, error)
}

// Exporter produces a user's client-side-encrypted export (ciphertext items +
// metadata). The scheduler seals this with the server data key before upload,
// so the artifact is doubly protected and the destination never holds keys.
type Exporter interface {
	ExportEncrypted(ctx context.Context, userID string) ([]byte, error)
}

// BackupConnector runs the OAuth consent + code-exchange for cloud providers.
// The infrastructure adapter holds the configured client credentials and HTTP
// client; the handler supplies the signed state and redirect URI.
type BackupConnector interface {
	// AuthorizeURL builds the provider consent URL, or an error when the
	// provider has no configured OAuth client.
	AuthorizeURL(provider backup.Provider, redirectURI, state string) (string, error)
	// Exchange swaps an authorization code for a durable refresh token.
	Exchange(ctx context.Context, provider backup.Provider, code, redirectURI string) (refreshToken string, err error)
}
