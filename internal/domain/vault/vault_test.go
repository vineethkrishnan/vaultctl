package vault

import (
	"errors"
	"strings"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func TestParseType(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{"personal", "shared"} {
		got, err := ParseType(raw)
		if err != nil || string(got) != raw {
			t.Fatalf("%q -> %v err=%v", raw, got, err)
		}
	}
	for _, raw := range []string{"", "team", "Personal"} {
		if _, err := ParseType(raw); !errors.Is(err, ErrInvalidType) {
			t.Fatalf("%q: expected ErrInvalidType, got %v", raw, err)
		}
	}
}

func TestType_Methods(t *testing.T) {
	t.Parallel()
	if !TypePersonal.IsValid() || !TypeShared.IsValid() || Type("x").IsValid() {
		t.Fatalf("IsValid wrong")
	}
	if TypePersonal.String() != "personal" {
		t.Fatalf("String broken")
	}
}

func TestVault_Validate_OK(t *testing.T) {
	t.Parallel()
	personal := Vault{ID: "v1", Name: "My Vault", Type: TypePersonal, CreatedBy: user.ID("u1")}
	if err := personal.Validate(); err != nil {
		t.Fatalf("personal valid: %v", err)
	}
	shared := Vault{ID: "v2", Name: "Team", Type: TypeShared, OrgID: "o1", CreatedBy: user.ID("u1")}
	if err := shared.Validate(); err != nil {
		t.Fatalf("shared valid: %v", err)
	}
	if !personal.IsPersonal() || shared.IsPersonal() {
		t.Fatalf("IsPersonal wrong")
	}
}

func TestVault_Validate_Invariants(t *testing.T) {
	t.Parallel()
	base := Vault{ID: "v1", Name: "X", Type: TypePersonal, CreatedBy: user.ID("u1")}
	cases := []struct {
		name   string
		mutate func(*Vault)
		field  string
	}{
		{"empty id", func(v *Vault) { v.ID = "" }, "id"},
		{"empty name", func(v *Vault) { v.Name = "" }, "name"},
		{"name too long", func(v *Vault) { v.Name = strings.Repeat("a", 256) }, "name"},
		{"bad type", func(v *Vault) { v.Type = Type("team") }, "type"},
		{"personal+org", func(v *Vault) { v.OrgID = "o1" }, "org_id"},
		{"shared no org", func(v *Vault) { v.Type = TypeShared; v.OrgID = "" }, "org_id"},
		{"empty creator", func(v *Vault) { v.CreatedBy = "" }, "created_by"},
	}
	for _, tc := range cases {
		v := base
		tc.mutate(&v)
		err := v.Validate()
		if err == nil {
			t.Fatalf("%s: expected error", tc.name)
		}
		var inv *domain.Invalid
		if !errors.As(err, &inv) || inv.Field != tc.field {
			t.Fatalf("%s: got %v", tc.name, err)
		}
	}
}

func TestID_Methods(t *testing.T) {
	t.Parallel()
	var zero ID
	if !zero.IsZero() || ID("x").IsZero() || ID("x").String() != "x" {
		t.Fatalf("ID helpers broken")
	}
}
