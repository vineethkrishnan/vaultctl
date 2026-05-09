// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"errors"
	"testing"
)

func TestTrimPasswordHistory_CapApplied(t *testing.T) {
	t.Parallel()
	const extra = 5
	entries := make([]int, MaxPasswordHistoryEntries+extra)
	for i := range entries {
		entries[i] = i
	}
	out := TrimPasswordHistory(entries)
	if len(out) != MaxPasswordHistoryEntries {
		t.Fatalf("len = %d, want %d", len(out), MaxPasswordHistoryEntries)
	}
	// Newest entries (i.e. highest indexes) must be the ones retained.
	if out[0] != extra || out[len(out)-1] != len(entries)-1 {
		t.Fatalf("wrong slice retained: first=%d last=%d", out[0], out[len(out)-1])
	}
}

func TestTrimPasswordHistory_BelowCap(t *testing.T) {
	t.Parallel()
	in := []int{1, 2, 3}
	out := TrimPasswordHistory(in)
	if len(out) != 3 || &in[0] != &out[0] {
		// Under cap, TrimPasswordHistory returns the input as-is
		// (length check + no allocation).
		t.Fatalf("under-cap input should be returned unchanged")
	}
}

func TestAssertPasswordHistoryCap(t *testing.T) {
	t.Parallel()
	ok := make([]int, MaxPasswordHistoryEntries)
	if err := AssertPasswordHistoryCap(ok); err != nil {
		t.Fatalf("at-cap should be ok: %v", err)
	}
	over := make([]int, MaxPasswordHistoryEntries+1)
	if err := AssertPasswordHistoryCap(over); !errors.Is(err, ErrHistoryOverflow) {
		t.Fatalf("over-cap: expected ErrHistoryOverflow, got %v", err)
	}
}
