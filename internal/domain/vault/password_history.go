package vault

import (
	"errors"
)

// MaxPasswordHistoryEntries is the cap on retained historical passwords per
// item (PRD §5.12). Applied client-side: older entries are dropped before
// re-encrypting the item payload.
const MaxPasswordHistoryEntries = 20

// ErrHistoryOverflow signals an attempt to retain more than the capped
// number of password-history entries.
var ErrHistoryOverflow = errors.New("vault: password history exceeds cap")

// TrimPasswordHistory keeps the most recent N entries (where N =
// MaxPasswordHistoryEntries) and returns a new slice. Callers pass entries
// ordered oldest-first; the newest ones are kept.
func TrimPasswordHistory[T any](entries []T) []T {
	if len(entries) <= MaxPasswordHistoryEntries {
		return entries
	}
	start := len(entries) - MaxPasswordHistoryEntries
	out := make([]T, MaxPasswordHistoryEntries)
	copy(out, entries[start:])
	return out
}

// AssertPasswordHistoryCap returns ErrHistoryOverflow if the slice exceeds
// the cap. Used by domain invariants before persistence.
func AssertPasswordHistoryCap[T any](entries []T) error {
	if len(entries) > MaxPasswordHistoryEntries {
		return ErrHistoryOverflow
	}
	return nil
}
