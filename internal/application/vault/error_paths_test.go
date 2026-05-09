// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// Wraps the fake repos to inject controlled failures on specific methods.

type itemRepoFailing struct {
	*fakeItemRepo
	updateErr     error
	softDeleteErr error
	restoreErr    error
	hardDelErr    error
	listActiveErr error
	listTrashErr  error
	purgeErr      error
}

func (r *itemRepoFailing) Update(ctx context.Context, it domainvault.Item) error {
	if r.updateErr != nil {
		return r.updateErr
	}
	return r.fakeItemRepo.Update(ctx, it)
}
func (r *itemRepoFailing) SoftDelete(ctx context.Context, v domainvault.ID, i domainvault.ItemID, at time.Time) error {
	if r.softDeleteErr != nil {
		return r.softDeleteErr
	}
	return r.fakeItemRepo.SoftDelete(ctx, v, i, at)
}
func (r *itemRepoFailing) Restore(ctx context.Context, v domainvault.ID, i domainvault.ItemID, at time.Time) error {
	if r.restoreErr != nil {
		return r.restoreErr
	}
	return r.fakeItemRepo.Restore(ctx, v, i, at)
}
func (r *itemRepoFailing) HardDelete(ctx context.Context, v domainvault.ID, i domainvault.ItemID) error {
	if r.hardDelErr != nil {
		return r.hardDelErr
	}
	return r.fakeItemRepo.HardDelete(ctx, v, i)
}
func (r *itemRepoFailing) ListActive(ctx context.Context, v domainvault.ID, o ports.ItemListOptions) ([]domainvault.Item, error) {
	if r.listActiveErr != nil {
		return nil, r.listActiveErr
	}
	return r.fakeItemRepo.ListActive(ctx, v, o)
}
func (r *itemRepoFailing) ListTrashed(ctx context.Context, v domainvault.ID) ([]domainvault.Item, error) {
	if r.listTrashErr != nil {
		return nil, r.listTrashErr
	}
	return r.fakeItemRepo.ListTrashed(ctx, v)
}
func (r *itemRepoFailing) PurgeExpired(ctx context.Context, cutoff time.Time) (int, error) {
	if r.purgeErr != nil {
		return 0, r.purgeErr
	}
	return r.fakeItemRepo.PurgeExpired(ctx, cutoff)
}

func seedMemberAndItem(t *testing.T) (*fakeVaultRepo, *itemRepoFailing) {
	t.Helper()
	vr := newFakeVaultRepo()
	vr.seed("v1", "u1", user.RoleMember)
	ir := &itemRepoFailing{fakeItemRepo: newFakeItemRepo()}
	ir.seedItem(domainvault.Item{
		ID: "i1", VaultID: "v1", ItemType: domainvault.ItemTypeLogin,
		EncryptedData: gcmBlob(), EncryptedName: gcmBlob(),
	})
	return vr, ir
}

func TestUpdateItem_PersistError(t *testing.T) {
	t.Parallel()
	vr, ir := seedMemberAndItem(t)
	ir.updateErr = errors.New("db down")
	uc := &UpdateItem{Vaults: vr, Items: ir, Clock: newTestClock()}
	_, err := uc.Execute(context.Background(), UpdateItemInput{
		Caller: "u1", VaultID: "v1", ItemID: "i1",
		EncryptedData: gcmBlob(), EncryptedName: gcmBlob(),
	})
	if err == nil || !strings.Contains(err.Error(), "persist update") {
		t.Fatalf("expected persist error, got %v", err)
	}
}

func TestUpdateItem_InvalidBlob(t *testing.T) {
	t.Parallel()
	vr, ir := seedMemberAndItem(t)
	uc := &UpdateItem{Vaults: vr, Items: ir, Clock: newTestClock()}
	_, err := uc.Execute(context.Background(), UpdateItemInput{
		Caller: "u1", VaultID: "v1", ItemID: "i1",
		EncryptedData: domainvault.Item{}.EncryptedData, // empty blob
		EncryptedName: gcmBlob(),
	})
	if err == nil {
		t.Fatalf("expected validation error")
	}
}

func TestUpdateItem_GetMiss(t *testing.T) {
	t.Parallel()
	vr, ir := seedMemberAndItem(t)
	uc := &UpdateItem{Vaults: vr, Items: ir, Clock: newTestClock()}
	_, err := uc.Execute(context.Background(), UpdateItemInput{
		Caller: "u1", VaultID: "v1", ItemID: "ghost",
		EncryptedData: gcmBlob(), EncryptedName: gcmBlob(),
	})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestTrashItem_GetMissAndRepoError(t *testing.T) {
	t.Parallel()
	vr, ir := seedMemberAndItem(t)
	uc := &TrashItem{Vaults: vr, Items: ir, Clock: newTestClock()}

	// Missing item
	if err := uc.Execute(context.Background(), TrashItemInput{Caller: "u1", VaultID: "v1", ItemID: "ghost"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
	// Soft-delete fails
	ir.softDeleteErr = errors.New("db down")
	if err := uc.Execute(context.Background(), TrashItemInput{Caller: "u1", VaultID: "v1", ItemID: "i1"}); err == nil {
		t.Fatalf("expected soft delete error")
	}
}

func TestRestoreItem_NonMemberAndMissing(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	ir := newFakeItemRepo()
	uc := &RestoreItem{Vaults: vr, Items: ir, Clock: newTestClock()}
	if err := uc.Execute(context.Background(), RestoreItemInput{Caller: "u1", VaultID: "v1", ItemID: "i1"}); !errors.Is(err, ErrNotMember) {
		t.Fatalf("non-member: %v", err)
	}

	// Member but item missing
	vr.seed("v1", "u1", user.RoleMember)
	if err := uc.Execute(context.Background(), RestoreItemInput{Caller: "u1", VaultID: "v1", ItemID: "ghost"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestRestoreItem_RepoError(t *testing.T) {
	t.Parallel()
	vr, ir := seedMemberAndItem(t)
	_ = ir.SoftDelete(context.Background(), "v1", "i1", time.Unix(testClockSec, 0).UTC())
	ir.restoreErr = errors.New("db down")
	uc := &RestoreItem{Vaults: vr, Items: ir, Clock: newTestClock()}
	if err := uc.Execute(context.Background(), RestoreItemInput{Caller: "u1", VaultID: "v1", ItemID: "i1"}); err == nil {
		t.Fatalf("expected restore error")
	}
}

func TestPurgeItem_NonMemberAndMissing(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	ir := newFakeItemRepo()
	uc := &PurgeItem{Vaults: vr, Items: ir}
	if err := uc.Execute(context.Background(), PurgeItemInput{Caller: "u1", VaultID: "v1", ItemID: "i1"}); !errors.Is(err, ErrNotMember) {
		t.Fatalf("non-member: %v", err)
	}
	vr.seed("v1", "u1", user.RoleMember)
	if err := uc.Execute(context.Background(), PurgeItemInput{Caller: "u1", VaultID: "v1", ItemID: "ghost"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestCreateItem_ValidationOnMissingCaller(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	vr.seed("v1", "u1", user.RoleMember)
	ir := newFakeItemRepo()
	uc := newCreateItem(vr, ir)
	_, err := uc.Execute(context.Background(), CreateItemInput{
		VaultID: "v1", ItemType: domainvault.ItemTypeLogin,
		EncryptedData: gcmBlob(), EncryptedName: gcmBlob(),
	})
	var inv *domain.Invalid
	if !errors.As(err, &inv) || inv.Field != "user_id" {
		t.Fatalf("expected invalid user_id, got %v", err)
	}
}

func TestListActive_NotMember(t *testing.T) {
	t.Parallel()
	uc := &ListActive{Vaults: newFakeVaultRepo(), Items: newFakeItemRepo()}
	_, err := uc.Execute(context.Background(), ListActiveInput{Caller: "u1", VaultID: "v1"})
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("expected ErrNotMember, got %v", err)
	}
}

func TestListTrash_NotMember(t *testing.T) {
	t.Parallel()
	uc := &ListTrash{Vaults: newFakeVaultRepo(), Items: newFakeItemRepo()}
	_, err := uc.Execute(context.Background(), ListTrashInput{Caller: "u1", VaultID: "v1"})
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("expected ErrNotMember, got %v", err)
	}
}

// ===========================================================================
// Folder error paths
// ===========================================================================

type folderRepoFailing struct {
	*fakeFolderRepo
	createErr error
	updateErr error
	deleteErr error
}

func (r *folderRepoFailing) Create(ctx context.Context, f domainvault.Folder) error {
	if r.createErr != nil {
		return r.createErr
	}
	return r.fakeFolderRepo.Create(ctx, f)
}
func (r *folderRepoFailing) Update(ctx context.Context, f domainvault.Folder) error {
	if r.updateErr != nil {
		return r.updateErr
	}
	return r.fakeFolderRepo.Update(ctx, f)
}

func TestCreateFolder_PersistError(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	vr.seed("v1", "u1", user.RoleMember)
	fr := &folderRepoFailing{fakeFolderRepo: newFakeFolderRepo(), createErr: errors.New("db down")}
	uc := &CreateFolder{Vaults: vr, Folders: fr, Clock: newTestClock(), IDs: &incrementingIDs{}}
	_, err := uc.Execute(context.Background(), CreateFolderInput{Caller: "u1", VaultID: "v1", EncryptedName: gcmBlob()})
	if err == nil || !strings.Contains(err.Error(), "persist folder") {
		t.Fatalf("expected persist folder wrapping, got %v", err)
	}
}

func TestCreateFolder_InvalidBlob(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	vr.seed("v1", "u1", user.RoleMember)
	uc := &CreateFolder{Vaults: vr, Folders: newFakeFolderRepo(), Clock: newTestClock(), IDs: &incrementingIDs{}}
	_, err := uc.Execute(context.Background(), CreateFolderInput{
		Caller: "u1", VaultID: "v1", EncryptedName: domainvault.Folder{}.EncryptedName,
	})
	if err == nil {
		t.Fatalf("expected validation error")
	}
}

func TestRenameFolder_NonMemberAndMissing(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	uc := &RenameFolder{Vaults: vr, Folders: newFakeFolderRepo()}
	_, err := uc.Execute(context.Background(), RenameFolderInput{Caller: "u1", VaultID: "v1", FolderID: "f1", EncryptedName: gcmBlob()})
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("non-member: %v", err)
	}

	vr.seed("v1", "u1", user.RoleMember)
	_, err = uc.Execute(context.Background(), RenameFolderInput{Caller: "u1", VaultID: "v1", FolderID: "ghost", EncryptedName: gcmBlob()})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("missing folder: %v", err)
	}
}

func TestRenameFolder_PersistError(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	vr.seed("v1", "u1", user.RoleMember)
	fr := &folderRepoFailing{fakeFolderRepo: newFakeFolderRepo(), updateErr: errors.New("db down")}
	_ = fr.fakeFolderRepo.Create(context.Background(), domainvault.Folder{ID: "f1", VaultID: "v1", EncryptedName: gcmBlob()})
	uc := &RenameFolder{Vaults: vr, Folders: fr}
	_, err := uc.Execute(context.Background(), RenameFolderInput{Caller: "u1", VaultID: "v1", FolderID: "f1", EncryptedName: gcmBlob()})
	if err == nil || !strings.Contains(err.Error(), "persist rename") {
		t.Fatalf("expected persist rename wrapping, got %v", err)
	}
}

func TestDeleteFolder_NonMember(t *testing.T) {
	t.Parallel()
	uc := &DeleteFolder{Vaults: newFakeVaultRepo(), Folders: newFakeFolderRepo()}
	err := uc.Execute(context.Background(), DeleteFolderInput{Caller: "u1", VaultID: "v1", FolderID: "f1"})
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("expected ErrNotMember, got %v", err)
	}
}

func TestListFolders_NotMember(t *testing.T) {
	t.Parallel()
	uc := &ListFolders{Vaults: newFakeVaultRepo(), Folders: newFakeFolderRepo()}
	_, err := uc.Execute(context.Background(), ListFoldersInput{Caller: "u1", VaultID: "v1"})
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("expected ErrNotMember, got %v", err)
	}
}

// ===========================================================================
// Cron error paths
// ===========================================================================

func TestPurgeExpiredTrash_RepoError(t *testing.T) {
	t.Parallel()
	ir := &itemRepoFailing{fakeItemRepo: newFakeItemRepo(), purgeErr: errors.New("db down")}
	uc := &PurgeExpiredTrash{Items: ir, Clock: newTestClock(), RetentionDays: 30}
	if _, err := uc.Execute(context.Background()); err == nil {
		t.Fatalf("expected purge error")
	}
}
