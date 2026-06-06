// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"context"
	"errors"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// CreateVaultInput carries the data needed to create a new vault.
type CreateVaultInput struct {
	Caller            user.ID
	Name              string
	Type              string
	OrgID             string
	EncryptedVaultKey crypto.EncryptedBlob
	WrapSignature     crypto.Signature
}

// CreateVault creates a new vault with the caller as the initial owner.
type CreateVault struct {
	Vaults ports.VaultRepository
	Orgs   ports.OrganizationRepository
	Clock  ports.Clock
	IDs    ports.IDGenerator
}

// Execute creates the vault and the creator's membership row.
func (uc *CreateVault) Execute(ctx context.Context, in CreateVaultInput) (VaultWithMembership, error) {
	vaultType, err := domainvault.ParseType(in.Type)
	if err != nil {
		return VaultWithMembership{}, err
	}

	if vaultType == domainvault.TypeShared {
		if err := uc.assertActiveOrgMember(ctx, organization.ID(in.OrgID), in.Caller); err != nil {
			return VaultWithMembership{}, err
		}
	}

	now := uc.Clock.Now()
	v := domainvault.Vault{
		ID:        domainvault.ID(uc.IDs.NewID()),
		Name:      in.Name,
		Type:      vaultType,
		OrgID:     in.OrgID,
		CreatedBy: in.Caller,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := v.Validate(); err != nil {
		return VaultWithMembership{}, err
	}

	m := domainvault.Member{
		VaultID:           v.ID,
		UserID:            in.Caller,
		EncryptedVaultKey: in.EncryptedVaultKey,
		SenderID:          in.Caller,
		WrapSignature:     in.WrapSignature,
		Role:              user.RoleOwner,
		AddedAt:           now,
	}
	if err := m.Validate(vaultType); err != nil {
		return VaultWithMembership{}, fmt.Errorf("member validation: %w", err)
	}

	if err := uc.Vaults.Create(ctx, v, m); err != nil {
		return VaultWithMembership{}, fmt.Errorf("persist vault: %w", err)
	}

	return VaultWithMembership{Vault: v, Member: m}, nil
}

// assertActiveOrgMember rejects a shared-vault creation unless the caller is an
// active (accepted-invite) member of the named organization.
func (uc *CreateVault) assertActiveOrgMember(ctx context.Context, orgID organization.ID, caller user.ID) error {
	if orgID.IsZero() {
		return domain.NewInvalid("org_id", "shared vaults require org_id")
	}
	membership, err := uc.Orgs.GetMembership(ctx, orgID, caller)
	if errors.Is(err, domain.ErrNotFound) {
		return domain.NewInvalid("org_id", "caller is not a member of this organization")
	}
	if err != nil {
		return fmt.Errorf("load org membership: %w", err)
	}
	if !membership.IsAccepted() {
		return domain.NewInvalid("org_id", "caller is not an active member of this organization")
	}
	return nil
}
