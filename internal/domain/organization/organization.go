// SPDX-License-Identifier: AGPL-3.0-or-later

// Package organization owns the Organization + Membership + Invite
// aggregates. Shared vaults live under an Organization; personal vaults
// never do.
package organization

import (
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// ID is the organization identifier (UUID in the DB).
type ID string

// String returns the underlying string.
func (o ID) String() string { return string(o) }

// IsZero reports whether the ID is unset.
func (o ID) IsZero() bool { return o == "" }

// Organization is the Organization aggregate root (PRD §9.5).
type Organization struct {
	ID        ID
	Name      string
	CreatedBy user.ID
	CreatedAt time.Time
}

// MaxNameLength mirrors organizations.name VARCHAR(255).
const MaxNameLength = 255

// Validate asserts the Organization invariants.
func (o Organization) Validate() error {
	if o.ID.IsZero() {
		return domain.NewInvalid("id", "required")
	}
	if o.Name == "" {
		return domain.NewInvalid("name", "required")
	}
	if len(o.Name) > MaxNameLength {
		return domain.NewInvalid("name", "too long")
	}
	if o.CreatedBy.IsZero() {
		return domain.NewInvalid("created_by", "required")
	}
	return nil
}

// Membership is the org_members row (PRD §9.5). InvitedAt records when the
// invite was issued; AcceptedAt is nil until the recipient redeems.
type Membership struct {
	OrgID      ID
	UserID     user.ID
	Role       user.Role
	InvitedAt  time.Time
	AcceptedAt *time.Time
}

// Validate asserts the Membership invariants.
func (m Membership) Validate() error {
	if m.OrgID.IsZero() {
		return domain.NewInvalid("org_id", "required")
	}
	if m.UserID.IsZero() {
		return domain.NewInvalid("user_id", "required")
	}
	if !m.Role.IsValid() {
		return domain.NewInvalid("role", "invalid")
	}
	if m.AcceptedAt != nil && m.AcceptedAt.Before(m.InvitedAt) {
		return domain.NewInvalid("accepted_at", "must be after invited_at")
	}
	return nil
}

// IsAccepted reports whether the member has accepted the invite.
func (m Membership) IsAccepted() bool { return m.AcceptedAt != nil }

// UserOrg is a read projection joining an Organization with the caller's role
// in it. It backs the "list the orgs I belong to" query (FEAT-8) so the admin
// UI can offer a selectable list instead of asking for a raw UUID.
type UserOrg struct {
	ID       ID
	Name     string
	Role     user.Role
	JoinedAt time.Time
}
