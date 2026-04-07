package organization

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func TestOrganization_Validate(t *testing.T) {
	t.Parallel()
	ok := Organization{ID: "o1", Name: "Acme", CreatedBy: user.ID("u1"), CreatedAt: time.Now()}
	if err := ok.Validate(); err != nil {
		t.Fatalf("valid org: %v", err)
	}
	cases := []struct {
		name   string
		mutate func(*Organization)
		field  string
	}{
		{"empty id", func(o *Organization) { o.ID = "" }, "id"},
		{"empty name", func(o *Organization) { o.Name = "" }, "name"},
		{"name too long", func(o *Organization) { o.Name = strings.Repeat("a", 256) }, "name"},
		{"empty creator", func(o *Organization) { o.CreatedBy = "" }, "created_by"},
	}
	for _, tc := range cases {
		o := ok
		tc.mutate(&o)
		err := o.Validate()
		var inv *domain.Invalid
		if !errors.As(err, &inv) || inv.Field != tc.field {
			t.Fatalf("%s: got %v", tc.name, err)
		}
	}
}

func TestID_Helpers(t *testing.T) {
	t.Parallel()
	var zero ID
	if !zero.IsZero() || ID("x").IsZero() || ID("x").String() != "x" {
		t.Fatalf("ID helpers broken")
	}
}

func TestMembership_Validate(t *testing.T) {
	t.Parallel()
	now := time.Now()
	later := now.Add(time.Hour)
	ok := Membership{OrgID: "o1", UserID: user.ID("u1"), Role: user.RoleMember, InvitedAt: now, AcceptedAt: &later}
	if err := ok.Validate(); err != nil {
		t.Fatalf("valid membership: %v", err)
	}
	if !ok.IsAccepted() {
		t.Fatalf("IsAccepted should be true")
	}

	pending := Membership{OrgID: "o1", UserID: user.ID("u1"), Role: user.RoleMember, InvitedAt: now}
	if pending.IsAccepted() {
		t.Fatalf("pending membership should not be accepted")
	}

	before := now.Add(-1 * time.Hour)
	cases := []struct {
		name   string
		mutate func(*Membership)
		field  string
	}{
		{"no org", func(m *Membership) { m.OrgID = "" }, "org_id"},
		{"no user", func(m *Membership) { m.UserID = "" }, "user_id"},
		{"bad role", func(m *Membership) { m.Role = user.Role("ghost") }, "role"},
		{"accepted-before-invited", func(m *Membership) { m.AcceptedAt = &before }, "accepted_at"},
	}
	for _, tc := range cases {
		m := ok
		tc.mutate(&m)
		err := m.Validate()
		var inv *domain.Invalid
		if !errors.As(err, &inv) || inv.Field != tc.field {
			t.Fatalf("%s: got %v", tc.name, err)
		}
	}
}
