// SPDX-License-Identifier: AGPL-3.0-or-later

package blobstore

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"io"
	"io/fs"
	"strings"
	"testing"
)

func TestFSStore_RoundTrip(t *testing.T) {
	store, err := NewFSStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewFSStore: %v", err)
	}
	ctx := context.Background()

	want := make([]byte, 4096)
	if _, err := rand.Read(want); err != nil {
		t.Fatal(err)
	}
	key := "abcdef0123456789"

	if err := store.Put(ctx, key, bytes.NewReader(want)); err != nil {
		t.Fatalf("Put: %v", err)
	}

	rc, err := store.Get(ctx, key)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	got, err := io.ReadAll(rc)
	rc.Close()
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("round-trip mismatch: got %d bytes, want %d", len(got), len(want))
	}
}

func TestFSStore_OverwriteAtomic(t *testing.T) {
	store, _ := NewFSStore(t.TempDir())
	ctx := context.Background()
	key := "overwrite-key01"

	_ = store.Put(ctx, key, strings.NewReader("first"))
	if err := store.Put(ctx, key, strings.NewReader("second-longer")); err != nil {
		t.Fatalf("overwrite Put: %v", err)
	}
	rc, _ := store.Get(ctx, key)
	got, _ := io.ReadAll(rc)
	rc.Close()
	if string(got) != "second-longer" {
		t.Fatalf("overwrite: got %q", got)
	}
}

func TestFSStore_GetMissing(t *testing.T) {
	store, _ := NewFSStore(t.TempDir())
	_, err := store.Get(context.Background(), "missing0000key")
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("expected fs.ErrNotExist, got %v", err)
	}
}

func TestFSStore_DeleteIsIdempotent(t *testing.T) {
	store, _ := NewFSStore(t.TempDir())
	ctx := context.Background()
	key := "delete-key00001"
	_ = store.Put(ctx, key, strings.NewReader("x"))
	if err := store.Delete(ctx, key); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if err := store.Delete(ctx, key); err != nil {
		t.Fatalf("Delete missing should be nil: %v", err)
	}
	if _, err := store.Get(ctx, key); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("expected gone after delete, got %v", err)
	}
}

func TestFSStore_RejectsUnsafeKeys(t *testing.T) {
	store, _ := NewFSStore(t.TempDir())
	ctx := context.Background()
	for _, bad := range []string{
		"../escape", "a/b/c", "..", "short", "has space", "with/slash", "",
		"dot.dot.key", strings.Repeat("a", 200),
	} {
		if err := store.Put(ctx, bad, strings.NewReader("x")); err == nil {
			t.Errorf("Put accepted unsafe key %q", bad)
		}
		if _, err := store.Get(ctx, bad); err == nil {
			t.Errorf("Get accepted unsafe key %q", bad)
		}
	}
}
