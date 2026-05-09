// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"context"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// ListVaultsInput carries the caller's identity.
type ListVaultsInput struct {
	Caller user.ID
}

// VaultWithMembership pairs a vault with the caller's membership row.
type VaultWithMembership struct {
	Vault  domainvault.Vault
	Member domainvault.Member
}

// ListVaults returns every vault the caller is an active member of, along
// with their per-vault encrypted key material.
type ListVaults struct {
	Vaults ports.VaultRepository
}

// Execute loads the caller's vaults and their membership rows.
func (uc *ListVaults) Execute(ctx context.Context, in ListVaultsInput) ([]VaultWithMembership, error) {
	vaults, err := uc.Vaults.ListForUser(ctx, in.Caller)
	if err != nil {
		return nil, fmt.Errorf("list vaults: %w", err)
	}

	out := make([]VaultWithMembership, 0, len(vaults))
	for _, v := range vaults {
		m, err := uc.Vaults.MemberForUser(ctx, v.ID, in.Caller)
		if err != nil {
			return nil, fmt.Errorf("load membership for vault %s: %w", v.ID, err)
		}
		out = append(out, VaultWithMembership{Vault: v, Member: m})
	}
	return out, nil
}
