// SPDX-License-Identifier: AGPL-3.0-or-later

// Package digest builds and schedules per-user activity digests from
// server-visible signals (logins, items added, new-device alerts, stale logins).
package digest

import "time"

// Frequency is how often a user wants a digest.
type Frequency string

const (
	Off       Frequency = "off"
	Daily     Frequency = "daily"
	Weekly    Frequency = "weekly"
	Monthly   Frequency = "monthly"
	Quarterly Frequency = "quarterly"
	Yearly    Frequency = "yearly"
)

// Valid reports whether f is a known frequency.
func (f Frequency) Valid() bool {
	switch f {
	case Off, Daily, Weekly, Monthly, Quarterly, Yearly:
		return true
	default:
		return false
	}
}

// Label is the human period name used in the email ("daily", "monthly", ...).
func (f Frequency) Label() string {
	return string(f)
}

// Window returns how far back a digest should look for a given frequency. Used
// for the very first digest, when there is no previous run to measure from.
func (f Frequency) Window() time.Duration {
	switch f {
	case Daily:
		return 24 * time.Hour
	case Weekly:
		return 7 * 24 * time.Hour
	case Monthly:
		return 30 * 24 * time.Hour
	case Quarterly:
		return 91 * 24 * time.Hour
	case Yearly:
		return 365 * 24 * time.Hour
	default:
		return 0
	}
}
