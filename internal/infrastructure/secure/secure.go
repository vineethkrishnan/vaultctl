// SPDX-License-Identifier: AGPL-3.0-or-later

// Package secure wraps memguard to give the rest of the server a single,
// minimal API for "sensitive bytes that must not sit in pageable memory."
//
// Scope (architecture §12.1 — "non-negotiable for a vault"):
//   - Long-lived server config secrets (HMAC peppers, data-encryption key,
//     JWT signing keys) are stored as *Secret for the lifetime of the
//     process and wiped on shutdown.
//   - Transient per-request material (client-submitted authHash) is wrapped
//     for the duration of the handler call so the source copy is zeroed
//     the instant the handler returns.
//
// Go's garbage collector cannot guarantee that sensitive byte slices are
// zeroed before reuse; memguard mlocks the pages, places guard pages on
// both sides, and zeroes the buffer on Destroy. Residual key material may
// still live inside crypto library state (e.g. an initialised cipher.Block
// keeps a copy of its key), but every read path through this package
// starts and ends with a zero-on-free LockedBuffer.
package secure

import "github.com/awnumar/memguard"

// Init installs memguard's signal handlers so every live LockedBuffer is
// wiped on SIGINT/SIGTERM before the process exits. Call exactly once from
// main before any Secret is constructed.
func Init() { memguard.CatchInterrupt() }

// Purge wipes every live LockedBuffer. Call from the normal shutdown path
// so a clean exit zeroes secrets too (Init only covers signal exits).
func Purge() { memguard.Purge() }

// Secret is an immutable wrapper around a memguard.LockedBuffer. Callers
// borrow the underlying bytes through Open for the minimum window and
// Destroy the Secret when it is no longer needed.
type Secret struct {
	lb *memguard.LockedBuffer
}

// NewSecretFromBytes wraps raw in a LockedBuffer. The input slice is
// wiped by memguard as part of the copy, so callers MUST NOT retain it.
// A nil or empty input returns a nil Secret.
func NewSecretFromBytes(raw []byte) *Secret {
	if len(raw) == 0 {
		return nil
	}
	return &Secret{lb: memguard.NewBufferFromBytes(raw)}
}

// NewSecretFromString wraps a string secret. Go strings are immutable, so
// the source cannot be zeroed — prefer NewSecretFromBytes whenever the
// caller owns a mutable slice (decoded config, parsed JSON, etc.).
func NewSecretFromString(s string) *Secret {
	if s == "" {
		return nil
	}
	return &Secret{lb: memguard.NewBufferFromBytes([]byte(s))}
}

// Open borrows the protected bytes for the minimum window. The fn
// receives a slice backed by the LockedBuffer — callers MUST NOT retain
// the slice past fn's return. A destroyed or nil Secret yields nil.
func (s *Secret) Open(fn func([]byte)) {
	if s == nil || s.lb == nil || !s.lb.IsAlive() {
		fn(nil)
		return
	}
	fn(s.lb.Bytes())
}

// WithBytes is a value-returning variant of Open for call sites that want
// to compute a result from the protected bytes without capturing the
// slice.
func WithBytes[T any](s *Secret, fn func([]byte) T) T {
	var zero T
	if s == nil || s.lb == nil || !s.lb.IsAlive() {
		return zero
	}
	return fn(s.lb.Bytes())
}

// Destroy wipes and releases the underlying buffer. Idempotent.
func (s *Secret) Destroy() {
	if s == nil || s.lb == nil {
		return
	}
	s.lb.Destroy()
	s.lb = nil
}

// Len reports the number of bytes stored, or 0 if nil/destroyed.
func (s *Secret) Len() int {
	if s == nil || s.lb == nil || !s.lb.IsAlive() {
		return 0
	}
	return s.lb.Size()
}

// IsZero reports whether the Secret holds no bytes (nil or destroyed).
func (s *Secret) IsZero() bool { return s.Len() == 0 }
