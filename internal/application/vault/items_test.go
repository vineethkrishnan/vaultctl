package vault

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

const testClockSec = 1_700_000_000

func newTestClock() *frozenClock {
	return &frozenClock{t: time.Unix(testClockSec, 0).UTC()}
}

func newCreateItem(repo *fakeVaultRepo, items *fakeItemRepo) *CreateItem {
	return &CreateItem{Vaults: repo, Items: items, Clock: newTestClock(), IDs: &incrementingIDs{}}
}

func validCreateInput() CreateItemInput {
	return CreateItemInput{
		Caller:        "u1",
		VaultID:       "v1",
		ItemType:      domainvault.ItemTypeLogin,
		EncryptedData: gcmBlob(),
		EncryptedName: gcmBlob(),
	}
}

func TestCreateItem_HappyPath(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("v1", "u1", user.RoleMember)
	items := newFakeItemRepo()
	uc := newCreateItem(repo, items)

	got, err := uc.Execute(context.Background(), validCreateInput())
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if got.ID == "" || got.VaultID != "v1" {
		t.Fatalf("bad result: %+v", got)
	}
}

func TestCreateItem_NotMember(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	items := newFakeItemRepo()
	uc := newCreateItem(repo, items)
	_, err := uc.Execute(context.Background(), validCreateInput())
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("expected ErrNotMember, got %v", err)
	}
}

func TestCreateItem_ValidationFails(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("v1", "u1", user.RoleMember)
	items := newFakeItemRepo()
	uc := newCreateItem(repo, items)
	in := validCreateInput()
	in.ItemType = domainvault.ItemType("bogus")
	_, err := uc.Execute(context.Background(), in)
	var inv *domain.Invalid
	if !errors.As(err, &inv) || inv.Field != "item_type" {
		t.Fatalf("expected invalid item_type, got %v", err)
	}
}

func TestCreateItem_PersistFails(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("v1", "u1", user.RoleMember)
	items := newFakeItemRepo()
	items.failOps["Create"] = errors.New("db down")
	uc := newCreateItem(repo, items)
	_, err := uc.Execute(context.Background(), validCreateInput())
	if err == nil {
		t.Fatalf("expected persist error")
	}
}

func TestGetItem_HappyPath(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("v1", "u1", user.RoleMember)
	items := newFakeItemRepo()
	items.seedItem(domainvault.Item{
		ID:            "i1",
		VaultID:       "v1",
		ItemType:      domainvault.ItemTypeLogin,
		EncryptedData: gcmBlob(),
		EncryptedName: gcmBlob(),
	})
	uc := &GetItem{Vaults: repo, Items: items}

	got, err := uc.Execute(context.Background(), GetItemInput{Caller: "u1", VaultID: "v1", ItemID: "i1"})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if got.ID != "i1" {
		t.Fatalf("wrong item: %+v", got)
	}
}

// ===========================================================================
// H11 cross-vault IDOR test
// ===========================================================================

// TestGetItem_CrossVaultIDOR_H11 is the dedicated cross-vault IDOR test
// called out in architecture §13.2 and M3 AC. User B is an active member
// of vault V-B; user A's item I-A exists in vault V-A (user B has no
// access to V-A). User B tries to read I-A by passing (V-B, I-A) as the
// URL path. The handler MUST return ErrNotFound — not "forbidden", not a
// leak of item existence.
func TestGetItem_CrossVaultIDOR_H11(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("V-B", "B", user.RoleMember) // B is in V-B only
	items := newFakeItemRepo()
	// User A's private item lives in V-A.
	items.seedItem(domainvault.Item{
		ID:            "I-A",
		VaultID:       "V-A",
		ItemType:      domainvault.ItemTypeLogin,
		EncryptedData: gcmBlob(),
		EncryptedName: gcmBlob(),
	})
	uc := &GetItem{Vaults: repo, Items: items}

	// B injects (V-B, I-A). Since B IS a member of V-B, the authz check
	// passes — but the item's vault_id is V-A, so the repo's
	// WHERE id=:id AND vault_id=:vaultId returns nothing.
	_, err := uc.Execute(context.Background(), GetItemInput{Caller: "B", VaultID: "V-B", ItemID: "I-A"})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("H11 IDOR guard broken: expected ErrNotFound, got %v", err)
	}

	// Control: a legit lookup still works if we use the right vault AND
	// we're a member of it.
	repo.seed("V-A", "A", user.RoleMember)
	got, err := uc.Execute(context.Background(), GetItemInput{Caller: "A", VaultID: "V-A", ItemID: "I-A"})
	if err != nil || got.ID != "I-A" {
		t.Fatalf("legit lookup broken: got=%+v err=%v", got, err)
	}
}

func TestGetItem_NonMember_IsNotFoundLike(t *testing.T) {
	// Non-members should get the authz error BEFORE the repo lookup — but
	// the presenter maps ErrNotMember + ErrNotFound identically (404).
	t.Parallel()
	repo := newFakeVaultRepo()
	items := newFakeItemRepo()
	uc := &GetItem{Vaults: repo, Items: items}
	_, err := uc.Execute(context.Background(), GetItemInput{Caller: "u1", VaultID: "v1", ItemID: "i1"})
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("expected ErrNotMember, got %v", err)
	}
}

// ===========================================================================
// Update / Trash / Restore / Purge
// ===========================================================================

func seedItem(items *fakeItemRepo) {
	items.seedItem(domainvault.Item{
		ID:            "i1",
		VaultID:       "v1",
		ItemType:      domainvault.ItemTypeLogin,
		EncryptedData: gcmBlob(),
		EncryptedName: gcmBlob(),
	})
}

func TestUpdateItem_HappyPath(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("v1", "u1", user.RoleMember)
	items := newFakeItemRepo()
	seedItem(items)
	clk := newTestClock()
	uc := &UpdateItem{Vaults: repo, Items: items, Clock: clk}

	out, err := uc.Execute(context.Background(), UpdateItemInput{
		Caller: "u1", VaultID: "v1", ItemID: "i1",
		EncryptedData: gcmBlob(), EncryptedName: gcmBlob(), Favorite: true,
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !out.Favorite {
		t.Fatalf("Favorite not applied")
	}
}

func TestUpdateItem_TrashedRejected(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("v1", "u1", user.RoleMember)
	items := newFakeItemRepo()
	seedItem(items)
	// Mark it trashed by direct mutation through SoftDelete.
	_ = items.SoftDelete(context.Background(), "v1", "i1", time.Unix(testClockSec, 0).UTC())

	uc := &UpdateItem{Vaults: repo, Items: items, Clock: newTestClock()}
	_, err := uc.Execute(context.Background(), UpdateItemInput{
		Caller: "u1", VaultID: "v1", ItemID: "i1",
		EncryptedData: gcmBlob(), EncryptedName: gcmBlob(),
	})
	var inv *domain.Invalid
	if !errors.As(err, &inv) || inv.Field != "item" {
		t.Fatalf("expected invalid-item, got %v", err)
	}
}

func TestUpdateItem_CrossVaultIDOR(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("V-B", "B", user.RoleMember)
	items := newFakeItemRepo()
	items.seedItem(domainvault.Item{
		ID: "I-A", VaultID: "V-A", ItemType: domainvault.ItemTypeLogin,
		EncryptedData: gcmBlob(), EncryptedName: gcmBlob(),
	})
	uc := &UpdateItem{Vaults: repo, Items: items, Clock: newTestClock()}
	_, err := uc.Execute(context.Background(), UpdateItemInput{
		Caller: "B", VaultID: "V-B", ItemID: "I-A",
		EncryptedData: gcmBlob(), EncryptedName: gcmBlob(),
	})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("update IDOR guard broken: %v", err)
	}
}

func TestTrashItem_LifecycleAndIdempotency(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("v1", "u1", user.RoleMember)
	items := newFakeItemRepo()
	seedItem(items)
	uc := &TrashItem{Vaults: repo, Items: items, Clock: newTestClock()}

	if err := uc.Execute(context.Background(), TrashItemInput{Caller: "u1", VaultID: "v1", ItemID: "i1"}); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	it, _ := items.Get(context.Background(), "v1", "i1")
	if !it.IsTrashed() {
		t.Fatalf("item not trashed")
	}
	// Idempotent: second call is a no-op.
	if err := uc.Execute(context.Background(), TrashItemInput{Caller: "u1", VaultID: "v1", ItemID: "i1"}); err != nil {
		t.Fatalf("idempotent Execute: %v", err)
	}
}

func TestTrashItem_IDOR(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("V-B", "B", user.RoleMember)
	items := newFakeItemRepo()
	items.seedItem(domainvault.Item{ID: "I-A", VaultID: "V-A", ItemType: domainvault.ItemTypeLogin, EncryptedData: gcmBlob(), EncryptedName: gcmBlob()})
	uc := &TrashItem{Vaults: repo, Items: items, Clock: newTestClock()}
	err := uc.Execute(context.Background(), TrashItemInput{Caller: "B", VaultID: "V-B", ItemID: "I-A"})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("trash IDOR guard broken: %v", err)
	}
	// And the victim's item must still be ACTIVE (not accidentally trashed).
	it, _ := items.Get(context.Background(), "V-A", "I-A")
	if it.IsTrashed() {
		t.Fatalf("cross-vault attacker managed to trash victim's item")
	}
}

func TestRestoreItem_HappyAndIdempotent(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("v1", "u1", user.RoleMember)
	items := newFakeItemRepo()
	seedItem(items)
	clk := newTestClock()
	_ = items.SoftDelete(context.Background(), "v1", "i1", clk.t)
	uc := &RestoreItem{Vaults: repo, Items: items, Clock: clk}

	if err := uc.Execute(context.Background(), RestoreItemInput{Caller: "u1", VaultID: "v1", ItemID: "i1"}); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	it, _ := items.Get(context.Background(), "v1", "i1")
	if it.IsTrashed() {
		t.Fatalf("item not restored")
	}
	// Idempotent on already-active items.
	if err := uc.Execute(context.Background(), RestoreItemInput{Caller: "u1", VaultID: "v1", ItemID: "i1"}); err != nil {
		t.Fatalf("idempotent: %v", err)
	}
}

func TestPurgeItem_OnlyTrashed(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("v1", "u1", user.RoleMember)
	items := newFakeItemRepo()
	seedItem(items)
	uc := &PurgeItem{Vaults: repo, Items: items}

	// Active -> refused
	err := uc.Execute(context.Background(), PurgeItemInput{Caller: "u1", VaultID: "v1", ItemID: "i1"})
	var inv *domain.Invalid
	if !errors.As(err, &inv) {
		t.Fatalf("active purge: expected invalid, got %v", err)
	}
	// Trash, then purge -> row is gone.
	_ = items.SoftDelete(context.Background(), "v1", "i1", time.Unix(testClockSec, 0).UTC())
	if err := uc.Execute(context.Background(), PurgeItemInput{Caller: "u1", VaultID: "v1", ItemID: "i1"}); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if _, err := items.Get(context.Background(), "v1", "i1"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("row should be gone, got %v", err)
	}
}

// ===========================================================================
// List + Trash
// ===========================================================================

func TestListActive_ExcludesTrash(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("v1", "u1", user.RoleMember)
	items := newFakeItemRepo()
	items.seedItem(domainvault.Item{ID: "a", VaultID: "v1", ItemType: domainvault.ItemTypeLogin, EncryptedData: gcmBlob(), EncryptedName: gcmBlob()})
	items.seedItem(domainvault.Item{ID: "b", VaultID: "v1", ItemType: domainvault.ItemTypeLogin, EncryptedData: gcmBlob(), EncryptedName: gcmBlob()})
	_ = items.SoftDelete(context.Background(), "v1", "b", time.Unix(testClockSec, 0).UTC())

	uc := &ListActive{Vaults: repo, Items: items}
	out, err := uc.Execute(context.Background(), ListActiveInput{Caller: "u1", VaultID: "v1"})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if len(out) != 1 || out[0].ID != "a" {
		t.Fatalf("list wrong: %+v", out)
	}
}

func TestListTrash_IncludesOnlyTrashed(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("v1", "u1", user.RoleMember)
	items := newFakeItemRepo()
	items.seedItem(domainvault.Item{ID: "a", VaultID: "v1", ItemType: domainvault.ItemTypeLogin, EncryptedData: gcmBlob(), EncryptedName: gcmBlob()})
	items.seedItem(domainvault.Item{ID: "b", VaultID: "v1", ItemType: domainvault.ItemTypeLogin, EncryptedData: gcmBlob(), EncryptedName: gcmBlob()})
	_ = items.SoftDelete(context.Background(), "v1", "b", time.Unix(testClockSec, 0).UTC())

	uc := &ListTrash{Vaults: repo, Items: items}
	out, err := uc.Execute(context.Background(), ListTrashInput{Caller: "u1", VaultID: "v1"})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if len(out) != 1 || out[0].ID != "b" {
		t.Fatalf("trash list wrong: %+v", out)
	}
}

// ===========================================================================
// PurgeExpiredTrash cron
// ===========================================================================

func TestPurgeExpiredTrash_OnlyPastCutoff(t *testing.T) {
	t.Parallel()
	items := newFakeItemRepo()
	// Item deleted 40 days ago.
	t0 := time.Unix(testClockSec, 0).UTC().Add(-40 * 24 * time.Hour)
	items.seedItem(domainvault.Item{ID: "a", VaultID: "v1", ItemType: domainvault.ItemTypeLogin, EncryptedData: gcmBlob(), EncryptedName: gcmBlob(), DeletedAt: &t0})
	// Item deleted 5 days ago.
	t1 := time.Unix(testClockSec, 0).UTC().Add(-5 * 24 * time.Hour)
	items.seedItem(domainvault.Item{ID: "b", VaultID: "v1", ItemType: domainvault.ItemTypeLogin, EncryptedData: gcmBlob(), EncryptedName: gcmBlob(), DeletedAt: &t1})

	uc := &PurgeExpiredTrash{Items: items, Clock: newTestClock(), RetentionDays: 30}
	n, err := uc.Execute(context.Background())
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if n != 1 {
		t.Fatalf("purged %d, expected 1", n)
	}
}

func TestPurgeExpiredTrash_BadRetention(t *testing.T) {
	t.Parallel()
	uc := &PurgeExpiredTrash{Items: newFakeItemRepo(), Clock: newTestClock(), RetentionDays: 0}
	if _, err := uc.Execute(context.Background()); err == nil {
		t.Fatalf("zero retention should error")
	}
}
