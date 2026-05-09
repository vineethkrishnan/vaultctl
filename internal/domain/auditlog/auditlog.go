// SPDX-License-Identifier: AGPL-3.0-or-later

package auditlog

import "time"

// Entry is one row in audit_logs. Fields mirror the SQL schema in
// migrations/20260405120000_init.up.sql.
//
// UserID, ResourceType, and ResourceID are optional — the repository
// translates zero values to SQL NULL. IPAddress is ALWAYS the already
// anonymised form (IPv4 /24 or IPv6 /56); raw addresses never enter this
// type.
type Entry struct {
	// UserID is the actor. Empty string means "unknown / unauthenticated"
	// (e.g. failed login with an email the server does not recognise) and
	// is written as NULL so the FK ON DELETE SET NULL still works.
	UserID string

	// Action is one of the Action* constants in actions.go. Enforced as a
	// stable enum by the audit.Writer facade.
	Action string

	// ResourceType is one of the Resource* constants. May be empty when
	// the action is not scoped to a specific resource (e.g. backup.run).
	ResourceType string

	// ResourceID is the UUID of the affected resource, or empty for none.
	ResourceID string

	// IPAddress is the ALREADY ANONYMISED client IP. The writer will
	// refuse (and swallow) writes for malformed addresses.
	IPAddress string

	// UserAgent is the raw User-Agent header value. No redaction — it is
	// not PII by itself.
	UserAgent string

	// CreatedAt is the event timestamp. The Writer fills this from its
	// injected Clock; callers never set it directly.
	CreatedAt time.Time
}
