// Package ports declares the interfaces through which the application layer
// reaches infrastructure. Use cases depend on these interfaces only; concrete
// adapters live in internal/infrastructure/*.
//
// This split is what keeps application + domain testable without a database
// or crypto lib, and what lets us swap out JWT for Ed25519 (architecture
// §12.2 item 5) without touching any use case.
package ports

import "time"

// Clock is the time source used by every use case. A single Clock instance
// is threaded through a request so that all timestamps in one operation are
// consistent (e.g. session.CreatedAt, token.iat, audit.created_at).
type Clock interface {
	Now() time.Time
}

// ClockFunc adapts a bare function into Clock.
type ClockFunc func() time.Time

// Now implements Clock.
func (f ClockFunc) Now() time.Time { return f() }

// RealClock returns the wall clock.
func RealClock() Clock { return ClockFunc(time.Now) }

// IDGenerator produces fresh opaque IDs. The domain treats IDs as opaque
// strings; the infrastructure backs them with UUID v4.
type IDGenerator interface {
	NewID() string
}

// RandomSource fills b with cryptographically secure random bytes. Used by
// domain-level code that needs entropy but must not import crypto/rand
// (e.g. generation of padding boundaries via application helpers).
type RandomSource interface {
	Read(b []byte) (int, error)
}
