// SPDX-License-Identifier: AGPL-3.0-or-later

// Package blobstore is a minimal filesystem-backed object store for encrypted
// attachment bytes. It deliberately avoids an external object store (S3,
// MinIO, SeaweedFS): a self-hosted vaultctl is "one binary + Postgres + a
// volume", and since every blob is client-encrypted the store only has to
// durably hold opaque ciphertext.
//
// Layout: blobs live at <root>/<ab>/<key>, sharded by the first two characters
// of the key to keep directories small. Writes are atomic (temp file + rename
// + fsync). Keys are server-generated and validated to prevent path traversal.
package blobstore

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

var _ ports.BlobStore = (*FSStore)(nil)

// keyPattern restricts keys to an opaque, filesystem-safe alphabet so a key
// can never contain a path separator or "..".
var keyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)

// FSStore stores blobs as files rooted at a directory.
type FSStore struct {
	root string
}

// NewFSStore creates the root directory (0700) and returns a store.
func NewFSStore(root string) (*FSStore, error) {
	if root == "" {
		return nil, fmt.Errorf("blobstore: empty root directory")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("blobstore: create root: %w", err)
	}
	return &FSStore{root: root}, nil
}

func (s *FSStore) pathFor(key string) (string, error) {
	if !keyPattern.MatchString(key) {
		return "", fmt.Errorf("blobstore: invalid key %q", key)
	}
	return filepath.Join(s.root, key[:2], key), nil
}

// Put streams r to <root>/<ab>/<key> atomically.
func (s *FSStore) Put(_ context.Context, key string, r io.Reader) (err error) {
	dest, err := s.pathFor(key)
	if err != nil {
		return err
	}
	dir := filepath.Dir(dest)
	if err = os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("blobstore: mkdir: %w", err)
	}

	tmp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		return fmt.Errorf("blobstore: temp: %w", err)
	}
	tmpName := tmp.Name()
	committed := false
	defer func() {
		if !committed {
			_ = tmp.Close()
			_ = os.Remove(tmpName)
		}
	}()

	if _, err = io.Copy(tmp, r); err != nil {
		return fmt.Errorf("blobstore: write: %w", err)
	}
	if err = tmp.Sync(); err != nil {
		return fmt.Errorf("blobstore: sync: %w", err)
	}
	if err = tmp.Close(); err != nil {
		return fmt.Errorf("blobstore: close: %w", err)
	}
	if err = os.Rename(tmpName, dest); err != nil {
		return fmt.Errorf("blobstore: rename: %w", err)
	}
	committed = true

	// Best-effort directory fsync so the rename survives a crash.
	if d, derr := os.Open(dir); derr == nil { //nolint:gosec // G304: dir derives from a key validated against keyPattern and joined under the fixed root
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}

// Get opens the blob for streaming; the caller closes it.
func (s *FSStore) Get(_ context.Context, key string) (io.ReadCloser, error) {
	dest, err := s.pathFor(key)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(dest) //nolint:gosec // G304: dest derives from a key validated against keyPattern and joined under the fixed root
	if err != nil {
		return nil, err // wraps fs.ErrNotExist when absent
	}
	return f, nil
}

// Delete removes the blob; a missing blob is not an error.
func (s *FSStore) Delete(_ context.Context, key string) error {
	dest, err := s.pathFor(key)
	if err != nil {
		return err
	}
	if err := os.Remove(dest); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("blobstore: delete: %w", err)
	}
	return nil
}
