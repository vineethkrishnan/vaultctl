package vault

import (
	"context"
	"errors"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

func TestCreateFolder_HappyPath(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	vr.seed("v1", "u1", user.RoleMember)
	fr := newFakeFolderRepo()
	uc := &CreateFolder{Vaults: vr, Folders: fr, Clock: newTestClock(), IDs: &incrementingIDs{}}

	f, err := uc.Execute(context.Background(), CreateFolderInput{
		Caller: "u1", VaultID: "v1", EncryptedName: gcmBlob(),
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if f.ID == "" || f.VaultID != "v1" {
		t.Fatalf("bad folder: %+v", f)
	}
}

func TestCreateFolder_NotMember(t *testing.T) {
	t.Parallel()
	uc := &CreateFolder{Vaults: newFakeVaultRepo(), Folders: newFakeFolderRepo(), Clock: newTestClock(), IDs: &incrementingIDs{}}
	_, err := uc.Execute(context.Background(), CreateFolderInput{Caller: "u1", VaultID: "v1", EncryptedName: gcmBlob()})
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("expected ErrNotMember, got %v", err)
	}
}

func TestRenameFolder_HappyPath(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	vr.seed("v1", "u1", user.RoleMember)
	fr := newFakeFolderRepo()
	_ = fr.Create(context.Background(), domainvault.Folder{ID: "f1", VaultID: "v1", EncryptedName: gcmBlob()})

	uc := &RenameFolder{Vaults: vr, Folders: fr}
	newBlob := gcmBlob()
	newBlob.Nonce[0] = 0xFF
	f, err := uc.Execute(context.Background(), RenameFolderInput{
		Caller: "u1", VaultID: "v1", FolderID: "f1", EncryptedName: newBlob,
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if f.EncryptedName.Nonce[0] != 0xFF {
		t.Fatalf("rename did not update blob")
	}
}

func TestRenameFolder_CrossVaultIDOR(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	vr.seed("V-B", "B", user.RoleMember)
	fr := newFakeFolderRepo()
	_ = fr.Create(context.Background(), domainvault.Folder{ID: "F-A", VaultID: "V-A", EncryptedName: gcmBlob()})

	uc := &RenameFolder{Vaults: vr, Folders: fr}
	_, err := uc.Execute(context.Background(), RenameFolderInput{
		Caller: "B", VaultID: "V-B", FolderID: "F-A", EncryptedName: gcmBlob(),
	})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("folder IDOR guard broken: %v", err)
	}
}

func TestDeleteFolder_HappyPath(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	vr.seed("v1", "u1", user.RoleMember)
	fr := newFakeFolderRepo()
	_ = fr.Create(context.Background(), domainvault.Folder{ID: "f1", VaultID: "v1", EncryptedName: gcmBlob()})

	uc := &DeleteFolder{Vaults: vr, Folders: fr}
	if err := uc.Execute(context.Background(), DeleteFolderInput{Caller: "u1", VaultID: "v1", FolderID: "f1"}); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if _, err := fr.Get(context.Background(), "v1", "f1"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("folder not deleted: %v", err)
	}
}

func TestDeleteFolder_NotFound(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	vr.seed("v1", "u1", user.RoleMember)
	uc := &DeleteFolder{Vaults: vr, Folders: newFakeFolderRepo()}
	err := uc.Execute(context.Background(), DeleteFolderInput{Caller: "u1", VaultID: "v1", FolderID: "ghost"})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestListFolders(t *testing.T) {
	t.Parallel()
	vr := newFakeVaultRepo()
	vr.seed("v1", "u1", user.RoleMember)
	fr := newFakeFolderRepo()
	_ = fr.Create(context.Background(), domainvault.Folder{ID: "f1", VaultID: "v1", EncryptedName: gcmBlob()})
	_ = fr.Create(context.Background(), domainvault.Folder{ID: "f2", VaultID: "v1", EncryptedName: gcmBlob()})
	_ = fr.Create(context.Background(), domainvault.Folder{ID: "f3", VaultID: "v2", EncryptedName: gcmBlob()}) // different vault

	uc := &ListFolders{Vaults: vr, Folders: fr}
	out, err := uc.Execute(context.Background(), ListFoldersInput{Caller: "u1", VaultID: "v1"})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("expected 2 folders, got %d", len(out))
	}
}
