// SPDX-License-Identifier: AGPL-3.0-or-later

package user

import (
	"errors"
	"testing"
)

func TestParseRole(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in      string
		want    Role
		wantErr bool
	}{
		{"member", RoleMember, false},
		{"admin", RoleAdmin, false},
		{"owner", RoleOwner, false},
		{"", "", true},
		{"guest", "", true},
		{"Owner", "", true}, // case-sensitive — canonical is lowercase
	}
	for _, tc := range cases {
		got, err := ParseRole(tc.in)
		if tc.wantErr {
			if !errors.Is(err, ErrInvalidRole) {
				t.Fatalf("%q: expected ErrInvalidRole, got %v", tc.in, err)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%q: unexpected %v", tc.in, err)
		}
		if got != tc.want {
			t.Fatalf("%q: got %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestRole_Predicates(t *testing.T) {
	t.Parallel()
	if !RoleOwner.CanAdminister() || !RoleAdmin.CanAdminister() {
		t.Fatalf("owner + admin must CanAdminister")
	}
	if RoleMember.CanAdminister() {
		t.Fatalf("member must not CanAdminister")
	}
	if !RoleOwner.CanTransferOwnership() || RoleAdmin.CanTransferOwnership() || RoleMember.CanTransferOwnership() {
		t.Fatalf("only owner transfers ownership")
	}
	if !RoleOwner.AtLeast(RoleAdmin) || !RoleAdmin.AtLeast(RoleMember) {
		t.Fatalf("rank ordering broken")
	}
	if RoleMember.AtLeast(RoleAdmin) {
		t.Fatalf("member should not be >= admin")
	}
	if Role("bogus").IsValid() {
		t.Fatalf("bogus role passed IsValid")
	}
	if Role("bogus").AtLeast(RoleMember) {
		t.Fatalf("bogus role should rank 0")
	}
	if Role("bogus").String() != "bogus" {
		t.Fatalf("String() broken")
	}
}
