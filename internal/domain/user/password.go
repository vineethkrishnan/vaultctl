// SPDX-License-Identifier: AGPL-3.0-or-later

package user

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
)

// MasterPasswordPolicy captures the registration-time strength rules. The
// default comes from PRD §5.11 (minimum 10 chars + common-list check). The
// policy is passed into ValidateMasterPassword so that operators can tighten
// rules via VAULTCTL_MIN_PASSWORD_LENGTH without changing domain code.
type MasterPasswordPolicy struct {
	MinLength      int
	RequireDiverse bool // requires at least 2 of: lower, upper, digit, symbol
	BlockedCommon  map[string]struct{}
	MaxLength      int // safety upper bound to defeat absurd Argon2 DoS inputs
}

// DefaultPolicy returns the policy shape described in PRD §5.11. Operators
// override MinLength via VAULTCTL_MIN_PASSWORD_LENGTH at config load time.
func DefaultPolicy() MasterPasswordPolicy {
	return MasterPasswordPolicy{
		MinLength:      10,
		RequireDiverse: true,
		MaxLength:      1024,
		BlockedCommon:  defaultCommonSet(),
	}
}

// ErrWeakMasterPassword signals a policy violation. Specific reasons are
// encoded in the wrapped message.
var ErrWeakMasterPassword = errors.New("user: master password too weak")

// ValidateMasterPassword returns nil if the supplied password meets the
// policy. The raw password is NOT stored — this function MUST be called on
// the client's pre-Argon2 input (server never sees the master password, per
// zero-knowledge model). The call exists so the application layer can reject
// weak passwords at the proof-of-work boundary before issuing the long KDF.
func ValidateMasterPassword(pw string, policy MasterPasswordPolicy) error {
	if policy.MinLength < 1 {
		policy.MinLength = 10
	}
	if policy.MaxLength <= 0 {
		policy.MaxLength = 1024
	}

	n := utf8.RuneCountInString(pw)
	if n < policy.MinLength {
		return fmt.Errorf("%w: length %d < %d", ErrWeakMasterPassword, n, policy.MinLength)
	}
	if n > policy.MaxLength {
		return fmt.Errorf("%w: length %d > %d", ErrWeakMasterPassword, n, policy.MaxLength)
	}

	if policy.RequireDiverse {
		var hasLower, hasUpper, hasDigit, hasSymbol bool
		for _, r := range pw {
			switch {
			case unicode.IsLower(r):
				hasLower = true
			case unicode.IsUpper(r):
				hasUpper = true
			case unicode.IsDigit(r):
				hasDigit = true
			case unicode.IsPunct(r) || unicode.IsSymbol(r) || unicode.IsSpace(r):
				hasSymbol = true
			}
		}
		classes := 0
		for _, ok := range []bool{hasLower, hasUpper, hasDigit, hasSymbol} {
			if ok {
				classes++
			}
		}
		if classes < 2 {
			return fmt.Errorf("%w: needs at least 2 character classes", ErrWeakMasterPassword)
		}
	}

	if _, blocked := policy.BlockedCommon[strings.ToLower(pw)]; blocked {
		return fmt.Errorf("%w: password is on the common-passwords blocklist", ErrWeakMasterPassword)
	}

	return nil
}

// ToDomainError wraps a weak-password error as a field-tagged domain.Invalid
// for handler consumption.
func ToDomainError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrWeakMasterPassword) {
		return domain.NewInvalid("master_password", err.Error())
	}
	return err
}

// defaultCommonSet is an illustrative set — M2 replaces this with the top-
// 10k list loaded from an embedded asset. We seed with the worst offenders
// so tests and dev environments have a working blocklist on day one.
func defaultCommonSet() map[string]struct{} {
	// NOTE: values are LOWER-CASED, whole-string matches only. We do not
	// perform leet-speak normalisation in v1 — the common-list substitute
	// from M2 will handle that properly.
	common := []string{
		"password", "password1", "password123", "p@ssw0rd",
		"123456", "12345678", "qwerty", "letmein", "welcome",
		"admin", "administrator", "root", "changeme", "iloveyou",
		"correct horse battery staple",
	}
	out := make(map[string]struct{}, len(common))
	for _, c := range common {
		out[c] = struct{}{}
	}
	return out
}
