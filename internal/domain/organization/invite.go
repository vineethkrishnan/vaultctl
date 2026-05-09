// SPDX-License-Identifier: AGPL-3.0-or-later

package organization

import (
	"errors"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// InviteTokenBits is the entropy floor for invite tokens (M11). Tokens are
// 256-bit random values; the DB stores only hmac_sha256(server_pepper, token).
const InviteTokenBits = 256

// InviteTokenHashSize is the length of the HMAC-SHA256 hash stored per invite.
const InviteTokenHashSize = 32

// MaxInviteTTL is the policy ceiling on invite lifetimes (M11: 24–72h).
const MaxInviteTTL = 72 * time.Hour

// MinInviteTTL keeps invites from being effectively dead-on-arrival.
const MinInviteTTL = 15 * time.Minute

// ErrInvalidInviteHash signals a wrong-length invite hash.
var ErrInvalidInviteHash = errors.New("organization: invalid invite hash length")

// InviteTokenHash is the opaque HMAC hash of the raw invite token. Like
// user.RefreshTokenHash, the domain never carries the raw token.
type InviteTokenHash struct {
	bytes []byte
}

// NewInviteTokenHash wraps a 32-byte HMAC output.
func NewInviteTokenHash(b []byte) (InviteTokenHash, error) {
	if len(b) != InviteTokenHashSize {
		return InviteTokenHash{}, ErrInvalidInviteHash
	}
	buf := make([]byte, len(b))
	copy(buf, b)
	return InviteTokenHash{bytes: buf}, nil
}

// Bytes returns a copy of the hash.
func (h InviteTokenHash) Bytes() []byte {
	out := make([]byte, len(h.bytes))
	copy(out, h.bytes)
	return out
}

// IsZero reports whether the hash is unset.
func (h InviteTokenHash) IsZero() bool { return len(h.bytes) == 0 }

// InviteID is the invite row identifier.
type InviteID string

// Invite is an organisation invite token record (M11).
//
// Single-use + TTL semantics are enforced by the application layer; the
// domain entity carries the invariants needed to compute state (used_at,
// revoked_at, expires_at).
type Invite struct {
	ID         InviteID
	OrgID      ID
	InvitedBy  user.ID
	Email      user.Email
	TokenHash  InviteTokenHash
	Role       user.Role
	ExpiresAt  time.Time
	CreatedAt  time.Time
	UsedAt     *time.Time
	RevokedAt  *time.Time
}

// Validate asserts the Invite invariants at creation time.
func (i Invite) Validate(now time.Time) error {
	if i.ID == "" {
		return domain.NewInvalid("id", "required")
	}
	if i.OrgID.IsZero() {
		return domain.NewInvalid("org_id", "required")
	}
	if i.InvitedBy.IsZero() {
		return domain.NewInvalid("invited_by", "required")
	}
	if i.Email.IsZero() {
		return domain.NewInvalid("email", "required")
	}
	if i.TokenHash.IsZero() {
		return domain.NewInvalid("token_hash", "required")
	}
	if !i.Role.IsValid() {
		return domain.NewInvalid("role", "invalid")
	}
	if i.ExpiresAt.IsZero() {
		return domain.NewInvalid("expires_at", "required")
	}
	// Enforce the TTL ceiling+floor so operators can't bypass M11 policy.
	if !i.CreatedAt.IsZero() {
		ttl := i.ExpiresAt.Sub(i.CreatedAt)
		if ttl < MinInviteTTL {
			return domain.NewInvalid("expires_at", "TTL below minimum")
		}
		if ttl > MaxInviteTTL {
			return domain.NewInvalid("expires_at", "TTL above 72h cap (M11)")
		}
	}
	if i.ExpiresAt.Before(now) {
		return domain.NewInvalid("expires_at", "already expired")
	}
	return nil
}

// IsRedeemable reports whether the invite is currently in a state that
// accepts redemption (not used, not revoked, not expired).
func (i Invite) IsRedeemable(now time.Time) bool {
	if i.UsedAt != nil {
		return false
	}
	if i.RevokedAt != nil {
		return false
	}
	return i.ExpiresAt.After(now)
}

// Redeem returns a new Invite marked as used at `at`. Returns an error if
// the invite is no longer redeemable — single-use enforcement is explicit.
func (i Invite) Redeem(at time.Time) (Invite, error) {
	if !i.IsRedeemable(at) {
		return Invite{}, domain.NewInvalid("invite", "not redeemable")
	}
	out := i
	out.UsedAt = &at
	return out, nil
}

// Revoke returns a new Invite marked as revoked at `at`.
func (i Invite) Revoke(at time.Time) Invite {
	if i.RevokedAt != nil {
		return i
	}
	out := i
	out.RevokedAt = &at
	return out
}
