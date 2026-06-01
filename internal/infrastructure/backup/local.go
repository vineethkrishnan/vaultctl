// SPDX-License-Identifier: AGPL-3.0-or-later

// Package backup holds the storage-backend adapters a backup destination writes
// its sealed artifacts to. Each adapter handles only opaque bytes under a name;
// the artifact is already the user's client-encrypted export, sealed again with
// the server data key, so a backend never sees plaintext or keys.
package backup

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

var _ ports.BackupStore = (*LocalStore)(nil)

// artifactName restricts names to a filesystem-safe alphabet so a name can
// never contain a path separator or "..".
var artifactName = regexp.MustCompile(`^[A-Za-z0-9._-]{8,160}$`)

// LocalStore writes artifacts to a directory on the server's own disk. This is
// the "local copy" destination: convenient, but a single disk failure loses it,
// which the UI surfaces to the user.
type LocalStore struct {
	dir string
}

// NewLocalStore roots a store at dir, creating it (0700) if needed.
func NewLocalStore(dir string) (*LocalStore, error) {
	if dir == "" {
		return nil, fmt.Errorf("backup/local: empty directory")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("backup/local: create dir: %w", err)
	}
	return &LocalStore{dir: dir}, nil
}

func (s *LocalStore) pathFor(name string) (string, error) {
	if !artifactName.MatchString(name) {
		return "", fmt.Errorf("backup/local: invalid artifact name %q", name)
	}
	return filepath.Join(s.dir, name), nil
}

// Put streams r to <dir>/<name> atomically (temp file + rename + fsync).
func (s *LocalStore) Put(_ context.Context, name string, r io.Reader, _ int64) (err error) {
	dest, err := s.pathFor(name)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.dir, ".upload-*")
	if err != nil {
		return fmt.Errorf("backup/local: temp: %w", err)
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
		return fmt.Errorf("backup/local: write: %w", err)
	}
	if err = tmp.Sync(); err != nil {
		return fmt.Errorf("backup/local: sync: %w", err)
	}
	if err = tmp.Close(); err != nil {
		return fmt.Errorf("backup/local: close: %w", err)
	}
	if err = os.Rename(tmpName, dest); err != nil {
		return fmt.Errorf("backup/local: rename: %w", err)
	}
	committed = true
	return nil
}

// List returns the artifacts in the directory, newest first.
func (s *LocalStore) List(_ context.Context) ([]ports.StoredObject, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, fmt.Errorf("backup/local: read dir: %w", err)
	}
	out := make([]ports.StoredObject, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !artifactName.MatchString(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, ports.StoredObject{
			Name:    e.Name(),
			Size:    info.Size(),
			ModTime: info.ModTime(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ModTime.After(out[j].ModTime) })
	return out, nil
}

// Get opens an artifact for streaming; the caller closes it.
func (s *LocalStore) Get(_ context.Context, name string) (io.ReadCloser, error) {
	dest, err := s.pathFor(name)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(dest) //nolint:gosec // G304: name validated against artifactName, joined under the fixed dir
	if err != nil {
		return nil, err
	}
	return f, nil
}

// Delete removes an artifact; a missing artifact is not an error.
func (s *LocalStore) Delete(_ context.Context, name string) error {
	dest, err := s.pathFor(name)
	if err != nil {
		return err
	}
	if err := os.Remove(dest); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("backup/local: delete: %w", err)
	}
	return nil
}
