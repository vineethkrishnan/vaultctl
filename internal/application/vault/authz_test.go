package vault

import (
	"context"
	"errors"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

func TestEnsureActiveMember_OK(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.seed("v1", "u1", user.RoleMember)
	role, err := ensureActiveMember(context.Background(), repo, "u1", "v1")
	if err != nil {
		t.Fatalf("ensureActiveMember: %v", err)
	}
	if role != user.RoleMember {
		t.Fatalf("role mismatch: %v", role)
	}
}

func TestEnsureActiveMember_NotMember(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	_, err := ensureActiveMember(context.Background(), repo, "u1", "v1")
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("expected ErrNotMember, got %v", err)
	}
}

func TestEnsureActiveMember_RejectsZeroInput(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	cases := []struct {
		name   string
		user   user.ID
		vault  domainvault.ID
		field  string
	}{
		{"empty user", "", "v1", "user_id"},
		{"empty vault", "u1", "", "vault_id"},
	}
	for _, tc := range cases {
		_, err := ensureActiveMember(context.Background(), repo, tc.user, tc.vault)
		var inv *domain.Invalid
		if !errors.As(err, &inv) || inv.Field != tc.field {
			t.Fatalf("%s: got %v", tc.name, err)
		}
	}
}

func TestEnsureActiveMember_RepoError(t *testing.T) {
	t.Parallel()
	repo := newFakeVaultRepo()
	repo.failOps["IsActiveMember"] = errors.New("db down")
	_, err := ensureActiveMember(context.Background(), repo, "u1", "v1")
	if err == nil {
		t.Fatalf("expected infra error")
	}
}

func TestEnsureRoleAtLeast(t *testing.T) {
	t.Parallel()
	if err := ensureRoleAtLeast(user.RoleAdmin, user.RoleMember); err != nil {
		t.Fatalf("admin >= member should pass: %v", err)
	}
	if err := ensureRoleAtLeast(user.RoleMember, user.RoleAdmin); !errors.Is(err, ErrInsufficientRole) {
		t.Fatalf("expected ErrInsufficientRole, got %v", err)
	}
}
