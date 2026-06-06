// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

func aesKWBlob() crypto.EncryptedBlob {
	return crypto.EncryptedBlob{
		Version:    crypto.V1,
		Alg:        crypto.AlgAES256KW,
		Ciphertext: bytes.Repeat([]byte{0x42}, 32),
		Tag:        bytes.Repeat([]byte{0x01}, 8),
	}
}

func rsaOAEPBlob() crypto.EncryptedBlob {
	return crypto.EncryptedBlob{
		Version:    crypto.V1,
		Alg:        crypto.AlgRSAOAEPSHA256,
		Ciphertext: bytes.Repeat([]byte{0x55}, 256),
	}
}

func sig(t *testing.T) crypto.Signature {
	t.Helper()
	s, err := crypto.NewEd25519Signature(bytes.Repeat([]byte{0xEE}, crypto.Ed25519SignatureSize))
	if err != nil {
		t.Fatalf("sig: %v", err)
	}
	return s
}

func newCreateVault() (*CreateVault, *fakeVaultRepo, *fakeOrgRepo) {
	vaults := newFakeVaultRepo()
	orgs := newFakeOrgRepo()
	uc := &CreateVault{
		Vaults: vaults,
		Orgs:   orgs,
		Clock:  &frozenClock{t: time.Unix(1700000000, 0)},
		IDs:    &incrementingIDs{},
	}
	return uc, vaults, orgs
}

func acceptedMember(orgID organization.ID, userID user.ID) organization.Membership {
	now := time.Unix(1690000000, 0)
	return organization.Membership{
		OrgID:      orgID,
		UserID:     userID,
		Role:       user.RoleMember,
		InvitedAt:  now,
		AcceptedAt: &now,
	}
}

func TestCreateVault_Personal_OK(t *testing.T) {
	t.Parallel()
	uc, vaults, _ := newCreateVault()
	out, err := uc.Execute(context.Background(), CreateVaultInput{
		Caller:            "u1",
		Name:              "Personal",
		Type:              "personal",
		EncryptedVaultKey: aesKWBlob(),
		WrapSignature:     sig(t),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Vault.OrgID != "" {
		t.Fatalf("personal vault OrgID = %q, want empty", out.Vault.OrgID)
	}
	stored, _ := vaults.Get(context.Background(), out.Vault.ID)
	if stored.Type != domainvault.TypePersonal {
		t.Fatalf("stored type = %q", stored.Type)
	}
}

func TestCreateVault_PersonalWithOrg_Rejected(t *testing.T) {
	t.Parallel()
	uc, _, _ := newCreateVault()
	_, err := uc.Execute(context.Background(), CreateVaultInput{
		Caller:            "u1",
		Name:              "Personal",
		Type:              "personal",
		OrgID:             "org-1",
		EncryptedVaultKey: aesKWBlob(),
		WrapSignature:     sig(t),
	})
	var invalid *domain.Invalid
	if !errors.As(err, &invalid) || invalid.Field != "org_id" {
		t.Fatalf("expected org_id invalid, got %v", err)
	}
}

func TestCreateVault_SharedWithoutOrg_Rejected(t *testing.T) {
	t.Parallel()
	uc, _, _ := newCreateVault()
	_, err := uc.Execute(context.Background(), CreateVaultInput{
		Caller:            "u1",
		Name:              "Team",
		Type:              "shared",
		EncryptedVaultKey: rsaOAEPBlob(),
		WrapSignature:     sig(t),
	})
	var invalid *domain.Invalid
	if !errors.As(err, &invalid) || invalid.Field != "org_id" {
		t.Fatalf("expected org_id invalid, got %v", err)
	}
}

func TestCreateVault_SharedForeignOrg_Rejected(t *testing.T) {
	t.Parallel()
	uc, _, orgs := newCreateVault()
	// Caller is a member of org-1, but tries to create a vault in org-2.
	orgs.seedMember(acceptedMember("org-1", "u1"))
	_, err := uc.Execute(context.Background(), CreateVaultInput{
		Caller:            "u1",
		Name:              "Team",
		Type:              "shared",
		OrgID:             "org-2",
		EncryptedVaultKey: rsaOAEPBlob(),
		WrapSignature:     sig(t),
	})
	var invalid *domain.Invalid
	if !errors.As(err, &invalid) || invalid.Field != "org_id" {
		t.Fatalf("expected org_id invalid (not a member), got %v", err)
	}
}

func TestCreateVault_SharedPendingInvite_Rejected(t *testing.T) {
	t.Parallel()
	uc, _, orgs := newCreateVault()
	pending := acceptedMember("org-1", "u1")
	pending.AcceptedAt = nil // invited but not yet accepted
	orgs.seedMember(pending)
	_, err := uc.Execute(context.Background(), CreateVaultInput{
		Caller:            "u1",
		Name:              "Team",
		Type:              "shared",
		OrgID:             "org-1",
		EncryptedVaultKey: rsaOAEPBlob(),
		WrapSignature:     sig(t),
	})
	var invalid *domain.Invalid
	if !errors.As(err, &invalid) || invalid.Field != "org_id" {
		t.Fatalf("expected org_id invalid (inactive member), got %v", err)
	}
}

func TestCreateVault_SharedOwnOrg_PersistsOrgID(t *testing.T) {
	t.Parallel()
	uc, vaults, orgs := newCreateVault()
	orgs.seedMember(acceptedMember("org-1", "u1"))
	out, err := uc.Execute(context.Background(), CreateVaultInput{
		Caller:            "u1",
		Name:              "Team",
		Type:              "shared",
		OrgID:             "org-1",
		EncryptedVaultKey: rsaOAEPBlob(),
		WrapSignature:     sig(t),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Vault.OrgID != "org-1" {
		t.Fatalf("OrgID = %q, want org-1", out.Vault.OrgID)
	}
	if out.Vault.Type != domainvault.TypeShared {
		t.Fatalf("type = %q, want shared", out.Vault.Type)
	}
	stored, _ := vaults.Get(context.Background(), out.Vault.ID)
	if stored.OrgID != "org-1" {
		t.Fatalf("persisted OrgID = %q, want org-1", stored.OrgID)
	}
	if out.Member.EncryptedVaultKey.Alg != crypto.AlgRSAOAEPSHA256 {
		t.Fatalf("member wrap alg = %v, want RSA-OAEP", out.Member.EncryptedVaultKey.Alg)
	}
}
