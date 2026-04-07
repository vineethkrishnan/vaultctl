package user

import (
	"errors"
	"fmt"
)

// Role is the GLOBAL user role (PRD §9.1 `users.role`). Per-vault roles live
// on VaultMember. Values are stored as lower-case strings in Postgres.
type Role string

const (
	RoleMember Role = "member"
	RoleAdmin  Role = "admin"
	RoleOwner  Role = "owner"
)

// ErrInvalidRole signals an unknown role value.
var ErrInvalidRole = errors.New("user: invalid role")

// ParseRole validates a raw string and returns the typed Role. Comparison is
// case-insensitive on input, but the canonical stored form is lower-case.
func ParseRole(raw string) (Role, error) {
	switch Role(raw) {
	case RoleMember, RoleAdmin, RoleOwner:
		return Role(raw), nil
	case "":
		return "", fmt.Errorf("%w: empty", ErrInvalidRole)
	default:
		return "", fmt.Errorf("%w: %q", ErrInvalidRole, raw)
	}
}

// String returns the canonical string form.
func (r Role) String() string { return string(r) }

// IsValid reports whether the role is one of the enumerated values.
func (r Role) IsValid() bool {
	switch r {
	case RoleMember, RoleAdmin, RoleOwner:
		return true
	}
	return false
}

// rank returns a numeric rank where higher = more privileged. Used only for
// role comparisons; NOT a wire format.
func (r Role) rank() int {
	switch r {
	case RoleOwner:
		return 3
	case RoleAdmin:
		return 2
	case RoleMember:
		return 1
	}
	return 0
}

// AtLeast reports whether r is at least as privileged as min.
func (r Role) AtLeast(min Role) bool { return r.rank() >= min.rank() }

// CanAdminister reports whether r may create users, change other users'
// roles, or hit admin-only endpoints. Owner + Admin qualify.
func (r Role) CanAdminister() bool { return r.AtLeast(RoleAdmin) }

// CanTransferOwnership reports whether r may perform ownership-transfer
// operations. Owner only.
func (r Role) CanTransferOwnership() bool { return r == RoleOwner }
