// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
)

func TestLocalStoreRoundTrip(t *testing.T) {
	store, err := NewLocalStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewLocalStore: %v", err)
	}
	ctx := context.Background()
	name := "vaultctl-export-20260601-120000.vctlbak"
	want := []byte("sealed-artifact-bytes")

	if err := store.Put(ctx, name, bytes.NewReader(want), int64(len(want))); err != nil {
		t.Fatalf("Put: %v", err)
	}
	rc, err := store.Get(ctx, name)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	got, _ := io.ReadAll(rc)
	rc.Close()
	if !bytes.Equal(got, want) {
		t.Fatalf("round-trip mismatch: got %q", got)
	}

	objects, err := store.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(objects) != 1 || objects[0].Name != name {
		t.Fatalf("List = %+v", objects)
	}

	if err := store.Delete(ctx, name); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := store.Get(ctx, name); err == nil {
		t.Fatal("expected error after delete")
	}
}

func TestLocalStoreRejectsUnsafeNames(t *testing.T) {
	store, _ := NewLocalStore(t.TempDir())
	ctx := context.Background()
	for _, bad := range []string{"../escape", "a/b", "short", strings.Repeat("x", 200)} {
		if err := store.Put(ctx, bad, strings.NewReader("x"), 1); err == nil {
			t.Errorf("Put(%q) should have been rejected", bad)
		}
	}
}
