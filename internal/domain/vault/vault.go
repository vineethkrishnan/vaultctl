// SPDX-License-Identifier: AGPL-3.0-or-later

// Package vault owns the Vault aggregate: containers for items, plus their
// membership, folders, and items themselves.
package vault

import (
	"errors"
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// ID is the vault identifier (UUID in the DB).
type ID string

// String returns the underlying string.
func (v ID) String() string { return string(v) }

// IsZero reports whether the ID is unset.
func (v ID) IsZero() bool { return v == "" }

// Type distinguishes a personal vault (single owner, no sharing) from a
// shared vault (organisation-scoped, multi-member).
type Type string

const (
	TypePersonal Type = "personal"
	TypeShared   Type = "shared"
)

// ErrInvalidType signals an unknown vault type.
var ErrInvalidType = errors.New("vault: invalid type")

// ParseType validates a raw string and returns the typed Type.
func ParseType(raw string) (Type, error) {
	switch Type(raw) {
	case TypePersonal, TypeShared:
		return Type(raw), nil
	default:
		return "", fmt.Errorf("%w: %q", ErrInvalidType, raw)
	}
}

// IsValid reports whether the type is enumerated.
func (t Type) IsValid() bool { return t == TypePersonal || t == TypeShared }

// String returns the canonical string.
func (t Type) String() string { return string(t) }

// Vault is the Vault aggregate root (PRD §9.2).
type Vault struct {
	ID        ID
	Name      string
	Type      Type
	OrgID     string // empty for TypePersonal
	CreatedBy user.ID
	CreatedAt time.Time
	UpdatedAt time.Time
}

// MaxNameLength matches vaults.name VARCHAR(255).
const MaxNameLength = 255

// Validate asserts the Vault invariants.
func (v Vault) Validate() error {
	if v.ID.IsZero() {
		return domain.NewInvalid("id", "required")
	}
	if v.Name == "" {
		return domain.NewInvalid("name", "required")
	}
	if len(v.Name) > MaxNameLength {
		return domain.NewInvalid("name", "too long")
	}
	if !v.Type.IsValid() {
		return domain.NewInvalid("type", "invalid")
	}
	// Personal vaults MUST NOT have an organisation; shared vaults MUST.
	switch v.Type {
	case TypePersonal:
		if v.OrgID != "" {
			return domain.NewInvalid("org_id", "personal vaults must not have org_id")
		}
	case TypeShared:
		if v.OrgID == "" {
			return domain.NewInvalid("org_id", "shared vaults require org_id")
		}
	}
	if v.CreatedBy.IsZero() {
		return domain.NewInvalid("created_by", "required")
	}
	return nil
}

// IsPersonal reports whether the vault is single-owner.
func (v Vault) IsPersonal() bool { return v.Type == TypePersonal }
