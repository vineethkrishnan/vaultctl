// SPDX-License-Identifier: AGPL-3.0-or-later

package postgres

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestIsInvalidTextRepresentation(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"malformed uuid", &pgconn.PgError{Code: "22P02"}, true},
		{"wrapped malformed uuid", fmt.Errorf("query: %w", &pgconn.PgError{Code: "22P02"}), true},
		{"unique violation", &pgconn.PgError{Code: "23505"}, false},
		{"plain error", errors.New("connection reset"), false},
		{"nil", nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isInvalidTextRepresentation(tc.err); got != tc.want {
				t.Fatalf("isInvalidTextRepresentation(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}
