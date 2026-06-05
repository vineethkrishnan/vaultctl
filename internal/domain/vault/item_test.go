// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"bytes"
	"errors"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

func validItem(t *testing.T) Item {
	t.Helper()
	return Item{
		ID:            ItemID("i1"),
		VaultID:       ID("v1"),
		ItemType:      ItemTypeLogin,
		EncryptedData: gcmBlob(t),
		EncryptedName: gcmBlob(t),
		CreatedAt:     time.Now(),
	}
}

func TestItem_Validate_OK(t *testing.T) {
	t.Parallel()
	if err := validItem(t).Validate(); err != nil {
		t.Fatalf("valid item: %v", err)
	}
}

func TestItem_Validate_Invariants(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		mutate func(*Item)
		field  string
	}{
		{"empty id", func(i *Item) { i.ID = "" }, "id"},
		{"empty vault", func(i *Item) { i.VaultID = "" }, "vault_id"},
		{"bad type", func(i *Item) { i.ItemType = ItemType("bogus") }, "item_type"},
		{"bad data blob", func(i *Item) { i.EncryptedData = crypto.EncryptedBlob{} }, "encrypted_data"},
		{"wrong alg data", func(i *Item) {
			b := i.EncryptedData
			b.Alg = crypto.AlgRSAOAEPSHA256
			b.Nonce = nil
			b.Tag = nil
			b.Ciphertext = bytes.Repeat([]byte{0x11}, 256)
			i.EncryptedData = b
		}, "encrypted_data"},
		{"bad name blob", func(i *Item) { i.EncryptedName = crypto.EncryptedBlob{} }, "encrypted_name"},
		{"wrong alg name", func(i *Item) {
			b := i.EncryptedName
			b.Alg = crypto.AlgAES256KW
			b.Nonce = nil
			b.Tag = bytes.Repeat([]byte{0}, 8)
			i.EncryptedName = b
		}, "encrypted_name"},
	}
	for _, tc := range cases {
		it := validItem(t)
		tc.mutate(&it)
		err := it.Validate()
		if err == nil {
			t.Fatalf("%s: expected error", tc.name)
		}
		var inv *domain.Invalid
		if !errors.As(err, &inv) || inv.Field != tc.field {
			t.Fatalf("%s: got %v", tc.name, err)
		}
	}
}

func TestItem_IDOR_BelongsToVault(t *testing.T) {
	t.Parallel()
	it := validItem(t)
	if !it.BelongsToVault(ID("v1")) {
		t.Fatalf("same vault id should match (H11)")
	}
	if it.BelongsToVault(ID("v2")) {
		t.Fatalf("different vault id MUST NOT match - IDOR guard broken (H11)")
	}
}

func TestItem_TrashRestore_Immutable(t *testing.T) {
	t.Parallel()
	it := validItem(t)
	if it.IsTrashed() {
		t.Fatalf("fresh item is not trashed")
	}
	now := time.Now()
	trashed := it.Trash(now)
	if it.IsTrashed() {
		t.Fatalf("original item mutated by Trash()")
	}
	if !trashed.IsTrashed() || trashed.DeletedAt == nil {
		t.Fatalf("Trash did not set DeletedAt")
	}
	if !trashed.UpdatedAt.Equal(now) {
		t.Fatalf("Trash did not touch UpdatedAt")
	}

	later := now.Add(time.Hour)
	restored := trashed.Restore(later)
	if restored.IsTrashed() || restored.DeletedAt != nil {
		t.Fatalf("Restore did not clear DeletedAt")
	}
	if !trashed.IsTrashed() {
		t.Fatalf("trashed copy mutated by Restore()")
	}
	if !restored.UpdatedAt.Equal(later) {
		t.Fatalf("Restore did not touch UpdatedAt")
	}
}

func TestItemID(t *testing.T) {
	t.Parallel()
	var zero ItemID
	if !zero.IsZero() || ItemID("x").IsZero() || ItemID("x").String() != "x" {
		t.Fatalf("ItemID helpers broken")
	}
}
