// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

type fakeBlobDeleter struct {
	mu      sync.Mutex
	deleted []string
	failOn  string
}

func (b *fakeBlobDeleter) Delete(_ context.Context, key string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if key == b.failOn {
		return errors.New("disk gone")
	}
	b.deleted = append(b.deleted, key)
	return nil
}

type fakeAttachmentRepoKeys struct{ keys []string }

func (a *fakeAttachmentRepoKeys) StorageKeysForVault(_ context.Context, _ domainvault.ID) ([]string, error) {
	return a.keys, nil
}

func seedOwnedVault(repo *fakeVaultRepo, id domainvault.ID, owner user.ID, role user.Role) {
	repo.seedVault(domainvault.Vault{ID: id, Name: string(id), Type: domainvault.TypePersonal, CreatedBy: owner})
	repo.seedMember(domainvault.Member{VaultID: id, UserID: owner, Role: role})
}

func seedTwoVaults(repo *fakeVaultRepo, owner user.ID) (domainvault.ID, domainvault.ID) {
	const target, other = domainvault.ID("v-target"), domainvault.ID("v-other")
	seedOwnedVault(repo, target, owner, user.RoleOwner)
	seedOwnedVault(repo, other, owner, user.RoleOwner)
	return target, other
}

func TestDeleteVault_OwnerDeletes(t *testing.T) {
	repo := newFakeVaultRepo()
	const owner user.ID = "u-owner"
	target, other := seedTwoVaults(repo, owner)

	uc := &DeleteVault{Vaults: repo}
	if err := uc.Execute(context.Background(), DeleteVaultInput{Caller: owner, VaultID: target}); err != nil {
		t.Fatalf("owner delete failed: %v", err)
	}
	remaining, err := repo.ListForUser(context.Background(), owner)
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 1 || remaining[0].ID != other {
		t.Fatalf("expected only %q to remain, got %v", other, remaining)
	}
	if _, stillMember, _ := repo.IsActiveMember(context.Background(), owner, target); stillMember {
		t.Fatal("membership row survived the vault delete")
	}
}

func TestDeleteVault_NonOwnerRejected(t *testing.T) {
	repo := newFakeVaultRepo()
	const owner, member user.ID = "u-owner", "u-member"
	target, _ := seedTwoVaults(repo, owner)
	repo.seedMember(domainvault.Member{VaultID: target, UserID: member, Role: user.RoleMember})
	// Give the member a second vault so the last-vault guard can't mask the
	// role check.
	seedOwnedVault(repo, "v-member-own", member, user.RoleOwner)

	uc := &DeleteVault{Vaults: repo}
	err := uc.Execute(context.Background(), DeleteVaultInput{Caller: member, VaultID: target})
	if !errors.Is(err, ErrInsufficientRole) {
		t.Fatalf("expected ErrInsufficientRole, got %v", err)
	}
}

func TestDeleteVault_NonMemberGets404Sentinel(t *testing.T) {
	repo := newFakeVaultRepo()
	const owner, stranger user.ID = "u-owner", "u-stranger"
	target, _ := seedTwoVaults(repo, owner)

	uc := &DeleteVault{Vaults: repo}
	err := uc.Execute(context.Background(), DeleteVaultInput{Caller: stranger, VaultID: target})
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("expected ErrNotMember, got %v", err)
	}
}

func TestDeleteVault_LastVaultRejected(t *testing.T) {
	repo := newFakeVaultRepo()
	const owner user.ID = "u-owner"
	const only = domainvault.ID("v-only")
	seedOwnedVault(repo, only, owner, user.RoleOwner)

	uc := &DeleteVault{Vaults: repo}
	err := uc.Execute(context.Background(), DeleteVaultInput{Caller: owner, VaultID: only})
	var inv *domain.Invalid
	if !errors.As(err, &inv) || inv.Field != "vault_id" {
		t.Fatalf("expected Invalid(vault_id) for last-vault delete, got %v", err)
	}
	if _, gerr := repo.Get(context.Background(), only); gerr != nil {
		t.Fatalf("last vault must survive: %v", gerr)
	}
}

func TestDeleteVault_BlobCleanupBestEffort(t *testing.T) {
	repo := newFakeVaultRepo()
	const owner user.ID = "u-owner"
	target, _ := seedTwoVaults(repo, owner)

	blobs := &fakeBlobDeleter{failOn: "k2"}
	uc := &DeleteVault{
		Vaults:      repo,
		Attachments: &fakeAttachmentRepoKeys{keys: []string{"k1", "k2", "k3"}},
		Blobs:       blobs,
	}
	if err := uc.Execute(context.Background(), DeleteVaultInput{Caller: owner, VaultID: target}); err != nil {
		t.Fatalf("delete failed despite blob error (must be best-effort): %v", err)
	}
	if len(blobs.deleted) != 2 {
		t.Fatalf("expected 2 blobs deleted around the failing one, got %v", blobs.deleted)
	}
}
