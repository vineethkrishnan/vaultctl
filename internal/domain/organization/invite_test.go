// SPDX-License-Identifier: AGPL-3.0-or-later

package organization

import (
	"bytes"
	"errors"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func validHash(t *testing.T) InviteTokenHash {
	t.Helper()
	h, err := NewInviteTokenHash(bytes.Repeat([]byte{0x42}, InviteTokenHashSize))
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	return h
}

func TestNewInviteTokenHash(t *testing.T) {
	t.Parallel()
	if _, err := NewInviteTokenHash(nil); !errors.Is(err, ErrInvalidInviteHash) {
		t.Fatalf("nil expected ErrInvalidInviteHash, got %v", err)
	}
	if _, err := NewInviteTokenHash(bytes.Repeat([]byte{0}, 31)); !errors.Is(err, ErrInvalidInviteHash) {
		t.Fatalf("31b expected ErrInvalidInviteHash")
	}

	h := validHash(t)
	if h.IsZero() {
		t.Fatalf("non-empty hash must not IsZero")
	}
	out := h.Bytes()
	out[0] = 0xFF
	if h.Bytes()[0] != 0x42 {
		t.Fatalf("Bytes() returned shared slice")
	}
	var zero InviteTokenHash
	if !zero.IsZero() {
		t.Fatalf("zero hash must IsZero")
	}
}

func validInvite(t *testing.T, now time.Time) Invite {
	t.Helper()
	email, _ := user.NewEmail("bob@example.com")
	return Invite{
		ID:        InviteID("i1"),
		OrgID:     ID("o1"),
		InvitedBy: user.ID("u1"),
		Email:     email,
		TokenHash: validHash(t),
		Role:      user.RoleMember,
		CreatedAt: now,
		ExpiresAt: now.Add(24 * time.Hour),
	}
}

func TestInvite_Validate_OK(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0).UTC()
	if err := validInvite(t, now).Validate(now); err != nil {
		t.Fatalf("valid invite: %v", err)
	}
}

func TestInvite_Validate_Invariants(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0).UTC()
	email, _ := user.NewEmail("a@b.com")
	cases := []struct {
		name   string
		mutate func(*Invite)
		field  string
	}{
		{"no id", func(i *Invite) { i.ID = "" }, "id"},
		{"no org", func(i *Invite) { i.OrgID = "" }, "org_id"},
		{"no inviter", func(i *Invite) { i.InvitedBy = "" }, "invited_by"},
		{"no email", func(i *Invite) { i.Email = user.Email{} }, "email"},
		{"no hash", func(i *Invite) { i.TokenHash = InviteTokenHash{} }, "token_hash"},
		{"bad role", func(i *Invite) { i.Role = user.Role("ghost") }, "role"},
		{"zero expiry", func(i *Invite) { i.ExpiresAt = time.Time{} }, "expires_at"},
		{"already expired", func(i *Invite) { i.ExpiresAt = now.Add(-1 * time.Hour); i.CreatedAt = now.Add(-2 * time.Hour) }, "expires_at"},
		{"TTL too short", func(i *Invite) { i.CreatedAt = now; i.ExpiresAt = now.Add(1 * time.Minute) }, "expires_at"},
		{"TTL too long", func(i *Invite) { i.CreatedAt = now; i.ExpiresAt = now.Add(100 * time.Hour) }, "expires_at"},
	}
	for _, tc := range cases {
		inv := validInvite(t, now)
		inv.Email = email
		tc.mutate(&inv)
		err := inv.Validate(now)
		if err == nil {
			t.Fatalf("%s: expected error", tc.name)
		}
		var d *domain.Invalid
		if !errors.As(err, &d) || d.Field != tc.field {
			t.Fatalf("%s: got %v", tc.name, err)
		}
	}
}

func TestInvite_LifeCycle(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0).UTC()
	i := validInvite(t, now)

	if !i.IsRedeemable(now) {
		t.Fatalf("fresh invite should be redeemable")
	}

	// Expired
	expired := i
	expired.ExpiresAt = now.Add(-1 * time.Minute)
	if expired.IsRedeemable(now) {
		t.Fatalf("expired invite must not be redeemable")
	}

	// Used
	later := now.Add(1 * time.Hour)
	used, err := i.Redeem(later)
	if err != nil {
		t.Fatalf("Redeem: %v", err)
	}
	if used.UsedAt == nil || !used.UsedAt.Equal(later) {
		t.Fatalf("UsedAt not set")
	}
	if i.UsedAt != nil {
		t.Fatalf("original invite mutated")
	}
	if used.IsRedeemable(later) {
		t.Fatalf("used invite must not be redeemable — single-use (M11)")
	}
	// Second redemption fails.
	if _, err := used.Redeem(later); err == nil {
		t.Fatalf("second Redeem should fail (single-use M11)")
	}

	// Revoked
	rev := i.Revoke(later)
	if rev.RevokedAt == nil {
		t.Fatalf("RevokedAt not set")
	}
	if i.RevokedAt != nil {
		t.Fatalf("Revoke mutated original")
	}
	// Double revoke is a no-op.
	rev2 := rev.Revoke(later.Add(time.Minute))
	if !rev2.RevokedAt.Equal(*rev.RevokedAt) {
		t.Fatalf("double-revoke should not change timestamp")
	}
	if rev.IsRedeemable(later) {
		t.Fatalf("revoked invite must not be redeemable")
	}
}
