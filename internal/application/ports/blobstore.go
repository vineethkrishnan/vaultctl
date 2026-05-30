// SPDX-License-Identifier: AGPL-3.0-or-later

package ports

import (
	"context"
	"io"
)

// BlobStore is opaque, content-agnostic storage for encrypted attachment
// bytes. The server only ever stores ciphertext, so the store needs no
// knowledge of structure — just durable put/get/delete of an opaque key.
//
// Keys are server-generated and opaque; implementations MUST reject keys that
// could escape their namespace (path traversal). This interface keeps the
// door open for an S3/MinIO adapter later without touching any use case.
type BlobStore interface {
	// Put writes the full contents of r under key, overwriting atomically.
	Put(ctx context.Context, key string, r io.Reader) error
	// Get opens the blob for streaming. The caller must Close it. A missing
	// blob returns an error satisfying errors.Is(err, fs.ErrNotExist).
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	// Delete removes the blob. Deleting a missing blob is not an error.
	Delete(ctx context.Context, key string) error
}
