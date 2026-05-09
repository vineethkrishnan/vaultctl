// SPDX-License-Identifier: AGPL-3.0-or-later

// Package user owns the User aggregate: email, master-password rules, roles,
// sessions, and identity-key metadata. All fields are value objects with
// invariants enforced at construction time.
package user

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
)

// Email is a normalised email address. Normalisation is the single-source-of-
// truth for lookups: everywhere the address is used (prelogin lookup, invite
// redemption, HMAC'd enumeration salt — H2) we operate on the normalised form.
type Email struct {
	value string
}

// ErrInvalidEmail signals a structurally invalid email; the message carries
// the specific reason.
var ErrInvalidEmail = errors.New("user: invalid email")

// MaxEmailLength matches the DB `VARCHAR(255)` (PRD §9.1).
const MaxEmailLength = 255

// NewEmail normalises and validates raw. Normalisation is: trim outer
// whitespace + lower-case the entire address. We do NOT strip Gmail-style
// dots or plus-tags — users often rely on those for addressing.
func NewEmail(raw string) (Email, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return Email{}, fmt.Errorf("%w: empty", ErrInvalidEmail)
	}
	if utf8.RuneCountInString(trimmed) > MaxEmailLength {
		return Email{}, fmt.Errorf("%w: exceeds %d runes", ErrInvalidEmail, MaxEmailLength)
	}
	lowered := strings.ToLower(trimmed)

	// Minimal structural check — full RFC 5322 validation is out of scope for
	// the domain layer. We enforce exactly ONE '@', non-empty local + domain,
	// and at least one '.' in the domain.
	at := strings.IndexByte(lowered, '@')
	if at <= 0 || at != strings.LastIndexByte(lowered, '@') || at == len(lowered)-1 {
		return Email{}, fmt.Errorf("%w: malformed", ErrInvalidEmail)
	}
	if !strings.ContainsRune(lowered[at+1:], '.') {
		return Email{}, fmt.Errorf("%w: domain missing '.'", ErrInvalidEmail)
	}
	if strings.ContainsAny(lowered, " \t\r\n") {
		return Email{}, fmt.Errorf("%w: whitespace in address", ErrInvalidEmail)
	}

	return Email{value: lowered}, nil
}

// String returns the normalised address.
func (e Email) String() string { return e.value }

// Equal performs a case-insensitive comparison (already-normalised values).
func (e Email) Equal(other Email) bool { return e.value == other.value }

// IsZero reports whether the email has no value.
func (e Email) IsZero() bool { return e.value == "" }

// MustBeValid is a convenience adaptor that returns a domain.Invalid for
// callers that want field-level error shaping.
func (e Email) MustBeValid(field string) error {
	if e.IsZero() {
		return domain.NewInvalid(field, "required")
	}
	return nil
}
