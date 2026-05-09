// SPDX-License-Identifier: AGPL-3.0-or-later

package domain

import (
	"errors"
	"testing"
)

func TestInvalid_Error(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		invalid *Invalid
		want    string
	}{
		{"with field", NewInvalid("email", "must be valid"), "domain: email: must be valid"},
		{"without field", &Invalid{Message: "boom"}, "domain: boom"},
	}
	for _, tc := range cases {
		if got := tc.invalid.Error(); got != tc.want {
			t.Fatalf("%s: Error() = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestInvalid_UnwrapsToErrInvalid(t *testing.T) {
	t.Parallel()
	err := NewInvalid("name", "too short")
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("errors.Is(err, ErrInvalid) = false, want true")
	}
}

func TestSentinels_AreDistinct(t *testing.T) {
	t.Parallel()
	sentinels := []error{ErrInvalid, ErrNotFound, ErrConflict, ErrForbidden}
	for i, a := range sentinels {
		for j, b := range sentinels {
			if i == j {
				continue
			}
			if errors.Is(a, b) {
				t.Fatalf("sentinel %d identical to %d", i, j)
			}
		}
	}
}
