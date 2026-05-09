// SPDX-License-Identifier: AGPL-3.0-or-later

package user

import (
	"errors"
	"strings"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
)

func TestNewEmail_Normalises(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in, want string
	}{
		{"Alice@Example.COM", "alice@example.com"},
		{"  bob@example.io  ", "bob@example.io"},
		{"c.d+tag@sub.example.org", "c.d+tag@sub.example.org"},
	}
	for _, tc := range cases {
		e, err := NewEmail(tc.in)
		if err != nil {
			t.Fatalf("%q: unexpected error %v", tc.in, err)
		}
		if e.String() != tc.want {
			t.Fatalf("%q -> %q, want %q", tc.in, e.String(), tc.want)
		}
	}
}

func TestNewEmail_Rejects(t *testing.T) {
	t.Parallel()
	cases := []string{
		"",
		"   ",
		"noat",
		"@nodomain",
		"nolocal@",
		"two@@at.com",
		"missing@dotcom",
		"has space@example.com",
		"em bedded@example.com",
		"tab\there@example.com",
		strings.Repeat("a", 256) + "@example.com",
	}
	for _, in := range cases {
		if _, err := NewEmail(in); err == nil {
			t.Fatalf("%q: expected error", in)
		} else if !errors.Is(err, ErrInvalidEmail) {
			t.Fatalf("%q: expected ErrInvalidEmail, got %v", in, err)
		}
	}
}

func TestEmail_EqualAndZero(t *testing.T) {
	t.Parallel()
	a, _ := NewEmail("A@example.com")
	b, _ := NewEmail("a@EXAMPLE.com")
	if !a.Equal(b) {
		t.Fatalf("case-folded equality failed")
	}
	var zero Email
	if !zero.IsZero() {
		t.Fatalf("zero-value should IsZero")
	}
	if a.IsZero() {
		t.Fatalf("non-zero email should not IsZero")
	}
}

func TestEmail_MustBeValid(t *testing.T) {
	t.Parallel()
	var zero Email
	if err := zero.MustBeValid("email"); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("zero email must return domain.ErrInvalid, got %v", err)
	}
	e, _ := NewEmail("x@y.com")
	if err := e.MustBeValid("email"); err != nil {
		t.Fatalf("valid email must pass, got %v", err)
	}
}
