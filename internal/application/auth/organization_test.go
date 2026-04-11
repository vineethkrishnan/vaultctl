package auth

import (
	"context"
	"errors"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// ===========================================================================
// fakeOrgRepo — minimal in-memory OrganizationRepository for M8 C2 tests.
// Single-org scope is intentional: RemoveOrgMember only needs to cascade
// within one organisation and the fake mirrors that surface area exactly.
// ===========================================================================

type orgMemberKey struct {
	orgID  organization.ID
	userID user.ID
}

type fakeOrgRepo struct {
	mu      sync.Mutex
	orgs    map[organization.ID]organization.Organization
	members map[orgMemberKey]organization.Membership
}

func newFakeOrgRepo() *fakeOrgRepo {
	return &fakeOrgRepo{
		orgs:    map[organization.ID]organization.Organization{},
		members: map[orgMemberKey]organization.Membership{},
	}
}

func (r *fakeOrgRepo) seedOrg(org organization.Organization) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.orgs[org.ID] = org
}

func (r *fakeOrgRepo) seedMember(m organization.Membership) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.members[orgMemberKey{m.OrgID, m.UserID}] = m
}

func (r *fakeOrgRepo) Create(_ context.Context, org organization.Organization, creator organization.Membership) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.orgs[org.ID] = org
	r.members[orgMemberKey{creator.OrgID, creator.UserID}] = creator
	return nil
}
func (r *fakeOrgRepo) GetByID(_ context.Context, id organization.ID) (organization.Organization, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	org, ok := r.orgs[id]
	if !ok {
		return organization.Organization{}, domain.ErrNotFound
	}
	return org, nil
}
func (r *fakeOrgRepo) GetMembership(_ context.Context, orgID organization.ID, userID user.ID) (organization.Membership, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, ok := r.members[orgMemberKey{orgID, userID}]
	if !ok {
		return organization.Membership{}, domain.ErrNotFound
	}
	return m, nil
}
func (r *fakeOrgRepo) ListMembers(_ context.Context, orgID organization.ID) ([]organization.Membership, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []organization.Membership{}
	for k, m := range r.members {
		if k.orgID == orgID {
			out = append(out, m)
		}
	}
	return out, nil
}
func (r *fakeOrgRepo) UpdateMemberRole(_ context.Context, orgID organization.ID, userID user.ID, role user.Role) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, ok := r.members[orgMemberKey{orgID, userID}]
	if !ok {
		return domain.ErrNotFound
	}
	m.Role = role
	r.members[orgMemberKey{orgID, userID}] = m
	return nil
}
func (r *fakeOrgRepo) RemoveMember(_ context.Context, orgID organization.ID, userID user.ID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := orgMemberKey{orgID, userID}
	if _, ok := r.members[key]; !ok {
		return domain.ErrNotFound
	}
	delete(r.members, key)
	return nil
}

// ===========================================================================
// cascadeVaultRepo — enough of VaultRepository to exercise RemoveOrgMember.
// It tracks per-user membership + vault metadata so ListForUser and
// RemoveMember behave realistically.
// ===========================================================================

type cascadeVaultRepo struct {
	mu      sync.Mutex
	vaults  map[vault.ID]vault.Vault
	members map[vaultMemberKey]bool // true = active
}

type vaultMemberKey struct {
	vaultID vault.ID
	userID  user.ID
}

func newCascadeVaultRepo() *cascadeVaultRepo {
	return &cascadeVaultRepo{
		vaults:  map[vault.ID]vault.Vault{},
		members: map[vaultMemberKey]bool{},
	}
}

func (r *cascadeVaultRepo) seedVault(v vault.Vault) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.vaults[v.ID] = v
}
func (r *cascadeVaultRepo) seedMember(vaultID vault.ID, userID user.ID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.members[vaultMemberKey{vaultID, userID}] = true
}

func (r *cascadeVaultRepo) Create(_ context.Context, _ vault.Vault, _ vault.Member) error {
	return nil
}
func (r *cascadeVaultRepo) Get(_ context.Context, id vault.ID) (vault.Vault, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.vaults[id]
	if !ok {
		return vault.Vault{}, domain.ErrNotFound
	}
	return v, nil
}
func (r *cascadeVaultRepo) ListForUser(_ context.Context, userID user.ID) ([]vault.Vault, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []vault.Vault{}
	for key, active := range r.members {
		if !active || key.userID != userID {
			continue
		}
		if v, ok := r.vaults[key.vaultID]; ok {
			out = append(out, v)
		}
	}
	// Deterministic order so AffectedVaults comparisons are stable.
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
func (r *cascadeVaultRepo) IsActiveMember(_ context.Context, userID user.ID, vaultID vault.ID) (user.Role, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.members[vaultMemberKey{vaultID, userID}] {
		return user.RoleMember, true, nil
	}
	return "", false, nil
}
func (r *cascadeVaultRepo) AddMember(_ context.Context, m vault.Member) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.members[vaultMemberKey{m.VaultID, m.UserID}] = true
	return nil
}
func (r *cascadeVaultRepo) RemoveMember(_ context.Context, vaultID vault.ID, userID user.ID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := vaultMemberKey{vaultID, userID}
	if _, ok := r.members[key]; !ok {
		return domain.ErrNotFound
	}
	r.members[key] = false
	return nil
}
func (r *cascadeVaultRepo) UpdateMemberRole(_ context.Context, _ vault.ID, _ user.ID, _ user.Role) error {
	return nil
}
func (r *cascadeVaultRepo) ListMembers(_ context.Context, vaultID vault.ID) ([]vault.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []vault.Member{}
	for key, active := range r.members {
		if !active || key.vaultID != vaultID {
			continue
		}
		out = append(out, vault.Member{VaultID: key.vaultID, UserID: key.userID})
	}
	return out, nil
}
func (r *cascadeVaultRepo) MemberForUser(_ context.Context, vaultID vault.ID, userID user.ID) (vault.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.members[vaultMemberKey{vaultID, userID}] {
		return vault.Member{VaultID: vaultID, UserID: userID}, nil
	}
	return vault.Member{}, domain.ErrNotFound
}
func (r *cascadeVaultRepo) ListSharedByOrgMember(_ context.Context, orgID organization.ID, userID user.ID) ([]vault.ID, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []vault.ID{}
	for key, active := range r.members {
		if !active || key.userID != userID {
			continue
		}
		v, ok := r.vaults[key.vaultID]
		if !ok {
			continue
		}
		if v.Type != vault.TypeShared || v.OrgID != string(orgID) {
			continue
		}
		out = append(out, key.vaultID)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out, nil
}

// ===========================================================================
// Tests
// ===========================================================================

// TestRemoveOrgMember_CascadesAcrossAllSharedVaults is the M8 / C2 cascade
// acceptance test: removing a user from an organisation must soft-delete
// their membership in EVERY shared vault in that org, hard-delete the
// org_members row, and return the affected vaults so the admin client can
// drive the per-vault rekey.
func TestRemoveOrgMember_CascadesAcrossAllSharedVaults(t *testing.T) {
	t.Parallel()

	orgs := newFakeOrgRepo()
	vaults := newCascadeVaultRepo()
	ctx := context.Background()

	const orgID = organization.ID("O")
	orgs.seedOrg(organization.Organization{
		ID: orgID, Name: "acme", CreatedBy: "admin", CreatedAt: time.Unix(1_700_000_000, 0).UTC(),
	})
	orgs.seedMember(organization.Membership{
		OrgID: orgID, UserID: "admin", Role: user.RoleOwner,
		InvitedAt: time.Unix(1_700_000_000, 0).UTC(),
	})
	orgs.seedMember(organization.Membership{
		OrgID: orgID, UserID: "X", Role: user.RoleMember,
		InvitedAt: time.Unix(1_700_000_000, 0).UTC(),
	})

	// Two shared vaults in org O, plus an unrelated personal vault that
	// must NOT be touched.
	vaults.seedVault(vault.Vault{
		ID: "V1", Name: "v1", Type: vault.TypeShared, OrgID: string(orgID), CreatedBy: "admin",
	})
	vaults.seedVault(vault.Vault{
		ID: "V2", Name: "v2", Type: vault.TypeShared, OrgID: string(orgID), CreatedBy: "admin",
	})
	vaults.seedVault(vault.Vault{
		ID: "VP", Name: "personal", Type: vault.TypePersonal, CreatedBy: "X",
	})
	vaults.seedMember("V1", "admin")
	vaults.seedMember("V1", "X")
	vaults.seedMember("V2", "admin")
	vaults.seedMember("V2", "X")
	vaults.seedMember("VP", "X")

	ids := &incrementingIDs{}
	uc := &RemoveOrgMember{Orgs: orgs, Vaults: vaults, IDs: ids}

	out, err := uc.Execute(ctx, RemoveOrgMemberInput{
		Caller:   "admin",
		OrgID:    orgID,
		TargetID: "X",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	// Affected vaults must be exactly V1 and V2 (order-independent).
	if len(out.AffectedVaults) != 2 {
		t.Fatalf("AffectedVaults wrong: %+v", out.AffectedVaults)
	}
	seen := map[vault.ID]bool{}
	for _, v := range out.AffectedVaults {
		seen[v] = true
	}
	if !seen["V1"] || !seen["V2"] {
		t.Fatalf("AffectedVaults missing V1/V2: %+v", out.AffectedVaults)
	}
	if seen["VP"] {
		t.Fatalf("personal vault VP should not cascade: %+v", out.AffectedVaults)
	}
	if out.RekeyJobID == "" {
		t.Fatalf("RekeyJobID must be set")
	}

	// Shared-vault memberships for X are soft-deleted.
	if _, ok, _ := vaults.IsActiveMember(ctx, "X", "V1"); ok {
		t.Fatalf("X still an active member of V1")
	}
	if _, ok, _ := vaults.IsActiveMember(ctx, "X", "V2"); ok {
		t.Fatalf("X still an active member of V2")
	}
	// Personal vault untouched (X still a member).
	if _, ok, _ := vaults.IsActiveMember(ctx, "X", "VP"); !ok {
		t.Fatalf("X's personal vault membership should NOT have been removed")
	}
	// admin still intact on V1/V2 — only the target cascades.
	if _, ok, _ := vaults.IsActiveMember(ctx, "admin", "V1"); !ok {
		t.Fatalf("admin should still be a V1 member")
	}

	// Org membership for X is hard-deleted.
	if _, err := orgs.GetMembership(ctx, orgID, "X"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("org_members for X should be gone, got %v", err)
	}
	// Owner row intact.
	if _, err := orgs.GetMembership(ctx, orgID, "admin"); err != nil {
		t.Fatalf("admin org membership should still exist: %v", err)
	}
}

// TestRemoveOrgMember_RefusesSelfRemoval mirrors the vault-level guard —
// no admin can remove themselves; ownership must be transferred first.
func TestRemoveOrgMember_RefusesSelfRemoval(t *testing.T) {
	t.Parallel()
	orgs := newFakeOrgRepo()
	vaults := newCascadeVaultRepo()
	orgs.seedMember(organization.Membership{
		OrgID: "O", UserID: "admin", Role: user.RoleOwner,
		InvitedAt: time.Unix(1_700_000_000, 0).UTC(),
	})
	uc := &RemoveOrgMember{Orgs: orgs, Vaults: vaults, IDs: &incrementingIDs{}}
	_, err := uc.Execute(context.Background(), RemoveOrgMemberInput{
		Caller: "admin", OrgID: "O", TargetID: "admin",
	})
	var inv *domain.Invalid
	if !errors.As(err, &inv) || inv.Field != "target_user" {
		t.Fatalf("expected invalid target_user, got %v", err)
	}
}

// TestRemoveOrgMember_NotAMember rejects removal of a ghost user.
func TestRemoveOrgMember_NotAMember(t *testing.T) {
	t.Parallel()
	orgs := newFakeOrgRepo()
	vaults := newCascadeVaultRepo()
	uc := &RemoveOrgMember{Orgs: orgs, Vaults: vaults, IDs: &incrementingIDs{}}
	_, err := uc.Execute(context.Background(), RemoveOrgMemberInput{
		Caller: "admin", OrgID: "O", TargetID: "ghost",
	})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}
