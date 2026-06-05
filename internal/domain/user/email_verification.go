// SPDX-License-Identifier: AGPL-3.0-or-later

package user

import "time"

// MaxVerificationAttempts caps wrong guesses against one emailed code before it
// must be resent. Kept low because the code is short.
const MaxVerificationAttempts = 5

// EmailVerification is the single active signup code for a user, held as an
// HMAC digest. The plaintext code exists only in the email and the verify
// request - never at rest.
type EmailVerification struct {
	UserID    ID
	CodeHash  []byte
	ExpiresAt time.Time
	Attempts  int
	CreatedAt time.Time
}

// Expired reports whether the code is past its lifetime as of now.
func (v EmailVerification) Expired(now time.Time) bool {
	return !now.Before(v.ExpiresAt)
}

// Exhausted reports whether too many wrong guesses have been made.
func (v EmailVerification) Exhausted() bool {
	return v.Attempts >= MaxVerificationAttempts
}
