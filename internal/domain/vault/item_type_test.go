// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"errors"
	"testing"
)

func TestAllItemTypes_Eight(t *testing.T) {
	t.Parallel()
	if got := len(AllItemTypes()); got != 8 {
		t.Fatalf("expected 8 item types, got %d", got)
	}
	seen := map[ItemType]struct{}{}
	for _, it := range AllItemTypes() {
		if _, dup := seen[it]; dup {
			t.Fatalf("duplicate item type %q", it)
		}
		seen[it] = struct{}{}
		if !it.IsValid() {
			t.Fatalf("AllItemTypes contains an invalid entry: %v", it)
		}
	}
}

func TestParseItemType(t *testing.T) {
	t.Parallel()
	for _, it := range AllItemTypes() {
		got, err := ParseItemType(string(it))
		if err != nil || got != it {
			t.Fatalf("%q roundtrip: got=%v err=%v", it, got, err)
		}
	}
	for _, bad := range []string{"", "password", "Login"} {
		if _, err := ParseItemType(bad); !errors.Is(err, ErrInvalidItemType) {
			t.Fatalf("%q expected ErrInvalidItemType, got %v", bad, err)
		}
	}
}

func TestItemType_RequiredFields(t *testing.T) {
	t.Parallel()
	cases := map[ItemType][]string{
		ItemTypeLogin:      {"name", "username", "password"},
		ItemTypeSecureNote: {"name", "content"},
		ItemTypeCreditCard: {"name", "number", "expiry"},
		ItemTypeIdentity:   {"name", "first_name", "last_name"},
		ItemTypeAPIKey:     {"name", "key"},
		ItemTypeSSHKey:     {"name", "private_key"},
		ItemTypePasskey:    {"name", "rp_id", "credential_id", "public_key"},
		ItemTypeGPGKey:     {"name", "private_key"},
	}
	for it, want := range cases {
		got := it.RequiredFields()
		if len(got) != len(want) {
			t.Fatalf("%s: len=%d want %d", it, len(got), len(want))
		}
		for i, f := range got {
			if f != want[i] {
				t.Fatalf("%s[%d] = %q, want %q", it, i, f, want[i])
			}
		}
	}
	if ItemType("bogus").RequiredFields() != nil {
		t.Fatalf("unknown type should yield nil RequiredFields")
	}
	if ItemTypeLogin.String() != "login" {
		t.Fatalf("String broken")
	}
}
