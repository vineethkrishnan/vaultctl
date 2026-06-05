// SPDX-License-Identifier: AGPL-3.0-or-later

package ports

import "context"

// Email is a single outbound transactional message. At least one of Text or
// HTML must be set; adapters that support both send multipart/alternative.
type Email struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

// Mailer sends transactional email (signup verification, security alerts,
// activity digests). The concrete adapter is chosen at wiring time: an SMTP
// adapter when a host is configured, otherwise a no-op logger so the server
// runs without mail.
type Mailer interface {
	// Send delivers one message. A delivery failure is returned to the caller,
	// which decides whether it is fatal; for alerts and digests it is not.
	Send(ctx context.Context, msg Email) error

	// Enabled reports whether real delivery is configured. Features that gate
	// on email (e.g. signup verification) treat a disabled mailer as "skip the
	// gate" so a deployment without SMTP stays fully usable.
	Enabled() bool
}
