// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPruneOldBackups(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	now := time.Now()
	old := now.Add(-100 * 24 * time.Hour)  // 100 days old
	fresh := now.Add(-10 * 24 * time.Hour) // 10 days old

	// Matrix of fixtures: name → mtime → should-be-pruned
	fixtures := []struct {
		name   string
		mtime  time.Time
		pruned bool
	}{
		{"vaultctl-20260101-000000.dump", old, true},
		{"vaultctl-20260401-000000.dump", fresh, false},
		{".env", old, false},               // unrelated — retention must NOT touch it
		{"unrelated.txt", old, false},      // foreign file — leave alone
		{"vaultctl-stray.txt", old, false}, // wrong suffix — leave alone
	}

	for _, f := range fixtures {
		path := filepath.Join(dir, f.name)
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatalf("write %s: %v", f.name, err)
		}
		if err := os.Chtimes(path, f.mtime, f.mtime); err != nil {
			t.Fatalf("chtimes %s: %v", f.name, err)
		}
	}

	// Retention 90 days: fixtures[0] is 100 days old → pruned; fixtures[1] is 10 days old → kept.
	pruned, err := pruneOldBackups(dir, 90, now)
	if err != nil {
		t.Fatalf("pruneOldBackups: %v", err)
	}
	if pruned != 1 {
		t.Errorf("pruned count = %d, want 1", pruned)
	}

	// Verify on disk
	for _, f := range fixtures {
		_, statErr := os.Stat(filepath.Join(dir, f.name))
		exists := !os.IsNotExist(statErr)
		wantExists := !f.pruned
		if exists != wantExists {
			t.Errorf("%s exists=%v, want %v", f.name, exists, wantExists)
		}
	}
}

func TestPruneOldBackups_MissingDir(t *testing.T) {
	t.Parallel()
	_, err := pruneOldBackups(filepath.Join(t.TempDir(), "nope"), 30, time.Now())
	if err == nil {
		t.Fatal("expected error for missing directory")
	}
}

func TestPruneOldBackups_NothingToPrune(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	pruned, err := pruneOldBackups(dir, 30, time.Now())
	if err != nil {
		t.Fatalf("pruneOldBackups: %v", err)
	}
	if pruned != 0 {
		t.Errorf("pruned count = %d, want 0", pruned)
	}
}
