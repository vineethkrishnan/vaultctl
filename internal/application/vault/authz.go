// SPDX-License-Identifier: AGPL-3.0-or-later

// Package vault contains the vault use cases: item CRUD, folder management,
// trash, and vault sharing. Every use case begins with an authorization
// check via ensureActiveMember.
//
// The H11 IDOR guard is enforced in TWO places:
//  1. ensureActiveMember verifies that the caller is a current member of
//     the target vault.
//  2. ItemRepository methods take BOTH vaultID and itemID, and the SQL
//     query includes `WHERE id = :id AND vault_id = :vaultId` so a request
//     carrying a foreign vault's UUID + a victim's item UUID returns
//     ErrNotFound — indistinguishable from "no such item".
package vault

import (
	"context"
	"errors"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// ErrNotMember is the authorization sentinel returned by ensureActiveMember.
// Handler layer maps it to HTTP 404 (NOT 403) — we don't leak "vault exists".
var ErrNotMember = errors.New("vault: caller is not an active member")

// ErrInsufficientRole is returned when the caller is a member but does not
// hold the required per-vault role (e.g. tries to remove another member
// without admin/owner rights).
var ErrInsufficientRole = errors.New("vault: insufficient role for this action")

// ensureActiveMember is the single authorization entry point for vault
// use cases. It is deliberately verbose — "active member (M3 removed_at
// filter applied)" is the key contract.
func ensureActiveMember(ctx context.Context, vaults ports.VaultRepository, userID user.ID, vaultID domainvault.ID) (user.Role, error) {
	if userID.IsZero() {
		return "", domain.NewInvalid("user_id", "required")
	}
	if vaultID.IsZero() {
		return "", domain.NewInvalid("vault_id", "required")
	}
	role, ok, err := vaults.IsActiveMember(ctx, userID, vaultID)
	if err != nil {
		return "", fmt.Errorf("authz: load membership: %w", err)
	}
	if !ok {
		return "", ErrNotMember
	}
	return role, nil
}

// ensureRoleAtLeast is a helper for use cases that need per-vault
// administrative privileges (add/remove members, share vault, rekey).
func ensureRoleAtLeast(role user.Role, minRole user.Role) error {
	if !role.AtLeast(minRole) {
		return ErrInsufficientRole
	}
	return nil
}
