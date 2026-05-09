// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"errors"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

func validFolder(t *testing.T) Folder {
	t.Helper()
	return Folder{
		ID:            FolderID("f1"),
		VaultID:       ID("v1"),
		EncryptedName: gcmBlob(t),
		CreatedAt:     time.Now(),
	}
}

func TestFolder_Validate_OK(t *testing.T) {
	t.Parallel()
	if err := validFolder(t).Validate(); err != nil {
		t.Fatalf("folder: %v", err)
	}
}

func TestFolder_Validate_Invariants(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		mutate func(*Folder)
		field  string
	}{
		{"empty id", func(f *Folder) { f.ID = "" }, "id"},
		{"empty vault", func(f *Folder) { f.VaultID = "" }, "vault_id"},
		{"bad blob", func(f *Folder) { f.EncryptedName = crypto.EncryptedBlob{} }, "encrypted_name"},
		{"wrong alg", func(f *Folder) {
			f.EncryptedName = kwBlob(t)
		}, "encrypted_name"},
	}
	for _, tc := range cases {
		f := validFolder(t)
		tc.mutate(&f)
		err := f.Validate()
		if err == nil {
			t.Fatalf("%s: expected error", tc.name)
		}
		var inv *domain.Invalid
		if !errors.As(err, &inv) || inv.Field != tc.field {
			t.Fatalf("%s: got %v", tc.name, err)
		}
	}
}
