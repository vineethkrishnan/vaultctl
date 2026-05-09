// SPDX-License-Identifier: AGPL-3.0-or-later

package user

import (
	"errors"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
)

// SessionID is the session row identifier.
type SessionID string

// RefreshTokenHash is the HMAC-SHA256 of the refresh token under the server
// pepper (C3). The raw refresh token NEVER lives in the domain or DB — it
// exists only in transit and in the client's Web Worker scope (M9).
//
// We model it as a fixed-length byte slice wrapper so that repositories can
// compare by bytes without accidentally accepting a raw token.
type RefreshTokenHash struct {
	bytes []byte
}

// ErrInvalidRefreshTokenHash signals a structurally wrong hash length.
var ErrInvalidRefreshTokenHash = errors.New("user: invalid refresh token hash")

// RefreshTokenHashSize is the HMAC-SHA256 output length (32 bytes).
const RefreshTokenHashSize = 32

// NewRefreshTokenHash wraps a 32-byte HMAC output.
func NewRefreshTokenHash(b []byte) (RefreshTokenHash, error) {
	if len(b) != RefreshTokenHashSize {
		return RefreshTokenHash{}, errors.Join(ErrInvalidRefreshTokenHash,
			domain.NewInvalid("refresh_token_hash", "wrong length"))
	}
	buf := make([]byte, len(b))
	copy(buf, b)
	return RefreshTokenHash{bytes: buf}, nil
}

// Bytes returns a copy of the hash.
func (h RefreshTokenHash) Bytes() []byte {
	out := make([]byte, len(h.bytes))
	copy(out, h.bytes)
	return out
}

// IsZero reports whether the hash is empty.
func (h RefreshTokenHash) IsZero() bool { return len(h.bytes) == 0 }

// Session is the Session aggregate (PRD §9.6). Stored against a user and
// bound to an opaque refresh_token_hash (never the raw token).
type Session struct {
	ID         SessionID
	UserID     ID
	TokenHash  RefreshTokenHash
	DeviceName string
	// IPAddress is the already-anonymised form per VAULTCTL_LOG_IP_PRECISION
	// (M1). The domain has no opinion on what "already anonymised" means
	// beyond "operator handled that in infrastructure".
	IPAddress     string
	ExpiresAt     time.Time
	LastRefreshAt *time.Time
	CreatedAt     time.Time
}

// MaxDeviceNameLength mirrors sessions.device_name VARCHAR(255).
const MaxDeviceNameLength = 255

// Validate asserts the session invariants.
func (s Session) Validate(now time.Time) error {
	if s.ID == "" {
		return domain.NewInvalid("id", "required")
	}
	if s.UserID.IsZero() {
		return domain.NewInvalid("user_id", "required")
	}
	if s.TokenHash.IsZero() {
		return domain.NewInvalid("token_hash", "required")
	}
	if len(s.DeviceName) > MaxDeviceNameLength {
		return domain.NewInvalid("device_name", "too long")
	}
	if s.ExpiresAt.IsZero() {
		return domain.NewInvalid("expires_at", "required")
	}
	if !s.CreatedAt.IsZero() && !s.ExpiresAt.After(s.CreatedAt) {
		return domain.NewInvalid("expires_at", "must be after created_at")
	}
	if s.ExpiresAt.Before(now) {
		return domain.NewInvalid("expires_at", "already expired")
	}
	return nil
}

// IsExpired reports whether the session has passed its TTL.
func (s Session) IsExpired(now time.Time) bool { return !s.ExpiresAt.After(now) }
