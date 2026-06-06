// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"bytes"
	"context"
	"sync"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// frozenClock mirrors the auth package fake.
type frozenClock struct{ t time.Time }

func (c *frozenClock) Now() time.Time { return c.t }
func (c *frozenClock) Advance(d time.Duration) {
	c.t = c.t.Add(d)
}

// incrementingIDs is a deterministic ID generator.
type incrementingIDs struct {
	mu sync.Mutex
	n  int
}

func (g *incrementingIDs) NewID() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.n++
	return "id-" + itoa(g.n)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var out []byte
	for n > 0 {
		out = append([]byte{byte('0' + n%10)}, out...)
		n /= 10
	}
	return string(out)
}

// gcmBlob returns a valid GCM-encrypted blob value object.
func gcmBlob() crypto.EncryptedBlob {
	return crypto.EncryptedBlob{
		Version:    crypto.V1,
		Alg:        crypto.AlgAES256GCM,
		Nonce:      bytes.Repeat([]byte{0xA1}, 12),
		Ciphertext: []byte("x"),
		Tag:        bytes.Repeat([]byte{0xB2}, 16),
	}
}

// ===========================================================================
// fakeVaultRepo
// ===========================================================================

type membershipKey struct {
	vaultID domainvault.ID
	userID  user.ID
}

type fakeVaultRepo struct {
	mu          sync.Mutex
	memberships map[membershipKey]user.Role
	// members is the richer view used by sharing/rekey/cascade tests.
	// When populated it supersedes memberships for IsActiveMember +
	// ListMembers + MemberForUser. The two maps coexist so that legacy
	// tests that only call `seed()` keep working.
	members map[membershipKey]*domainvault.Member
	vaults  map[domainvault.ID]domainvault.Vault
	failOps map[string]error
}

func newFakeVaultRepo() *fakeVaultRepo {
	return &fakeVaultRepo{
		memberships: map[membershipKey]user.Role{},
		members:     map[membershipKey]*domainvault.Member{},
		vaults:      map[domainvault.ID]domainvault.Vault{},
		failOps:     map[string]error{},
	}
}

// seed grants userID membership in vaultID with role.
func (r *fakeVaultRepo) seed(vaultID domainvault.ID, userID user.ID, role user.Role) {
	r.memberships[membershipKey{vaultID, userID}] = role
}

// seedVault registers a Vault row so Get returns it.
func (r *fakeVaultRepo) seedVault(v domainvault.Vault) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.vaults[v.ID] = v
}

// seedMember installs a full Member row for sharing/rekey tests. Also
// mirrors the role into memberships for legacy IsActiveMember callers.
func (r *fakeVaultRepo) seedMember(m domainvault.Member) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := m
	r.members[membershipKey{m.VaultID, m.UserID}] = &cp
	r.memberships[membershipKey{m.VaultID, m.UserID}] = m.Role
}

func (r *fakeVaultRepo) Create(_ context.Context, v domainvault.Vault, m domainvault.Member) error {
	if err := r.failOps["Create"]; err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.vaults[v.ID] = v
	cp := m
	r.members[membershipKey{m.VaultID, m.UserID}] = &cp
	r.memberships[membershipKey{m.VaultID, m.UserID}] = m.Role
	return nil
}
func (r *fakeVaultRepo) Get(_ context.Context, id domainvault.ID) (domainvault.Vault, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.vaults[id]
	if !ok {
		return domainvault.Vault{}, nil
	}
	return v, nil
}
func (r *fakeVaultRepo) ListForUser(_ context.Context, userID user.ID) ([]domainvault.Vault, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []domainvault.Vault{}
	for k, m := range r.members {
		if k.userID != userID || !m.IsActive() {
			continue
		}
		if v, ok := r.vaults[k.vaultID]; ok {
			out = append(out, v)
		}
	}
	return out, nil
}
func (r *fakeVaultRepo) IsActiveMember(_ context.Context, u user.ID, v domainvault.ID) (user.Role, bool, error) {
	if err := r.failOps["IsActiveMember"]; err != nil {
		return "", false, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	// Rich members table wins - it carries RemovedAt soft-delete state.
	if m, ok := r.members[membershipKey{v, u}]; ok {
		if !m.IsActive() {
			return "", false, nil
		}
		return m.Role, true, nil
	}
	role, ok := r.memberships[membershipKey{v, u}]
	return role, ok, nil
}
func (r *fakeVaultRepo) AddMember(_ context.Context, m domainvault.Member) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := m
	r.members[membershipKey{m.VaultID, m.UserID}] = &cp
	r.memberships[membershipKey{m.VaultID, m.UserID}] = m.Role
	return nil
}
func (r *fakeVaultRepo) RemoveMember(_ context.Context, vaultID domainvault.ID, userID user.ID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := membershipKey{vaultID, userID}
	if m, ok := r.members[key]; ok {
		now := time.Now()
		m.RemovedAt = &now
	}
	delete(r.memberships, key)
	return nil
}
func (r *fakeVaultRepo) UpdateMemberRole(_ context.Context, _ domainvault.ID, _ user.ID, _ user.Role) error {
	return nil
}
func (r *fakeVaultRepo) ListMembers(_ context.Context, vaultID domainvault.ID) ([]domainvault.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []domainvault.Member{}
	for k, m := range r.members {
		if k.vaultID == vaultID && m.IsActive() {
			out = append(out, *m)
		}
	}
	return out, nil
}
func (r *fakeVaultRepo) MemberForUser(_ context.Context, vaultID domainvault.ID, userID user.ID) (domainvault.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, ok := r.members[membershipKey{vaultID, userID}]
	if !ok || !m.IsActive() {
		return domainvault.Member{}, domain.ErrNotFound
	}
	return *m, nil
}
func (r *fakeVaultRepo) ListSharedByOrgMember(_ context.Context, orgID organization.ID, userID user.ID) ([]domainvault.ID, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []domainvault.ID{}
	for k, m := range r.members {
		if k.userID != userID || !m.IsActive() {
			continue
		}
		v, ok := r.vaults[k.vaultID]
		if !ok {
			continue
		}
		if v.Type != domainvault.TypeShared {
			continue
		}
		if v.OrgID != string(orgID) {
			continue
		}
		out = append(out, k.vaultID)
	}
	return out, nil
}

// ===========================================================================
// fakeOrgRepo - minimal OrganizationRepository for shared-vault creation tests.
// Only GetMembership is exercised by CreateVault; the rest satisfy the port.
// ===========================================================================

type fakeOrgRepo struct {
	mu      sync.Mutex
	members map[orgMemberKey]organization.Membership
}

type orgMemberKey struct {
	orgID  organization.ID
	userID user.ID
}

func newFakeOrgRepo() *fakeOrgRepo {
	return &fakeOrgRepo{members: map[orgMemberKey]organization.Membership{}}
}

func (r *fakeOrgRepo) seedMember(m organization.Membership) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.members[orgMemberKey{m.OrgID, m.UserID}] = m
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

func (r *fakeOrgRepo) Create(_ context.Context, _ organization.Organization, _ organization.Membership) error {
	return nil
}
func (r *fakeOrgRepo) GetByID(_ context.Context, _ organization.ID) (organization.Organization, error) {
	return organization.Organization{}, domain.ErrNotFound
}
func (r *fakeOrgRepo) ListMembers(_ context.Context, _ organization.ID) ([]organization.Membership, error) {
	return nil, nil
}
func (r *fakeOrgRepo) ListForUser(_ context.Context, _ user.ID) ([]organization.UserOrg, error) {
	return nil, nil
}
func (r *fakeOrgRepo) UpdateMemberRole(_ context.Context, _ organization.ID, _ user.ID, _ user.Role) error {
	return nil
}
func (r *fakeOrgRepo) RemoveMember(_ context.Context, _ organization.ID, _ user.ID) error {
	return nil
}

// ===========================================================================
// fakeItemRepo
// ===========================================================================

type itemKey struct {
	vaultID domainvault.ID
	itemID  domainvault.ItemID
}

type fakeItemRepo struct {
	mu      sync.Mutex
	byKey   map[itemKey]*domainvault.Item
	failOps map[string]error
	// When IDOR=true, Get silently returns ErrNotFound if vaultID doesn't
	// match the stored item - mirroring the real SQL query's guard.
}

func newFakeItemRepo() *fakeItemRepo {
	return &fakeItemRepo{byKey: map[itemKey]*domainvault.Item{}, failOps: map[string]error{}}
}

// seedItem inserts a pre-built item. Used by tests to stage state.
func (r *fakeItemRepo) seedItem(it domainvault.Item) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := it
	r.byKey[itemKey{it.VaultID, it.ID}] = &cp
}

func (r *fakeItemRepo) Create(_ context.Context, it domainvault.Item) error {
	if err := r.failOps["Create"]; err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := it
	r.byKey[itemKey{it.VaultID, it.ID}] = &cp
	return nil
}
func (r *fakeItemRepo) Get(_ context.Context, v domainvault.ID, i domainvault.ItemID) (domainvault.Item, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// KEY IS (vault_id, item_id) - this is the IDOR guard at the repo
	// level. A (wrong_vault, victim_item) lookup returns nothing.
	it, ok := r.byKey[itemKey{v, i}]
	if !ok {
		return domainvault.Item{}, domain.ErrNotFound
	}
	return *it, nil
}
func (r *fakeItemRepo) Update(_ context.Context, it domainvault.Item) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := itemKey{it.VaultID, it.ID}
	if _, ok := r.byKey[k]; !ok {
		return domain.ErrNotFound
	}
	cp := it
	r.byKey[k] = &cp
	return nil
}
func (r *fakeItemRepo) SoftDelete(_ context.Context, v domainvault.ID, i domainvault.ItemID, at time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	it, ok := r.byKey[itemKey{v, i}]
	if !ok {
		return domain.ErrNotFound
	}
	t := at
	it.DeletedAt = &t
	it.UpdatedAt = at
	return nil
}
func (r *fakeItemRepo) Restore(_ context.Context, v domainvault.ID, i domainvault.ItemID, at time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	it, ok := r.byKey[itemKey{v, i}]
	if !ok {
		return domain.ErrNotFound
	}
	it.DeletedAt = nil
	it.UpdatedAt = at
	return nil
}
func (r *fakeItemRepo) HardDelete(_ context.Context, v domainvault.ID, i domainvault.ItemID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.byKey, itemKey{v, i})
	return nil
}
func (r *fakeItemRepo) ListActive(_ context.Context, v domainvault.ID, _ ports.ItemListOptions) ([]domainvault.Item, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []domainvault.Item{}
	for k, it := range r.byKey {
		if k.vaultID == v && it.DeletedAt == nil {
			out = append(out, *it)
		}
	}
	return out, nil
}
func (r *fakeItemRepo) ListTrashed(_ context.Context, v domainvault.ID) ([]domainvault.Item, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []domainvault.Item{}
	for k, it := range r.byKey {
		if k.vaultID == v && it.DeletedAt != nil {
			out = append(out, *it)
		}
	}
	return out, nil
}
func (r *fakeItemRepo) PurgeExpired(_ context.Context, cutoff time.Time) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for k, it := range r.byKey {
		if it.DeletedAt != nil && it.DeletedAt.Before(cutoff) {
			delete(r.byKey, k)
			n++
		}
	}
	return n, nil
}
func (r *fakeItemRepo) PurgeExpiredInVault(_ context.Context, vaultID domainvault.ID, cutoff time.Time) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for k, it := range r.byKey {
		if k.vaultID == vaultID && it.DeletedAt != nil && it.DeletedAt.Before(cutoff) {
			delete(r.byKey, k)
			n++
		}
	}
	return n, nil
}
func (r *fakeItemRepo) CreateBatch(ctx context.Context, items []domainvault.Item) error {
	for _, it := range items {
		if err := r.Create(ctx, it); err != nil {
			return err
		}
	}
	return nil
}

// ===========================================================================
// fakeFolderRepo
// ===========================================================================

type folderKey struct {
	vaultID  domainvault.ID
	folderID domainvault.FolderID
}

type fakeFolderRepo struct {
	mu    sync.Mutex
	byKey map[folderKey]*domainvault.Folder
}

func newFakeFolderRepo() *fakeFolderRepo {
	return &fakeFolderRepo{byKey: map[folderKey]*domainvault.Folder{}}
}

func (r *fakeFolderRepo) Create(_ context.Context, f domainvault.Folder) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := f
	r.byKey[folderKey{f.VaultID, f.ID}] = &cp
	return nil
}
func (r *fakeFolderRepo) Get(_ context.Context, v domainvault.ID, f domainvault.FolderID) (domainvault.Folder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out, ok := r.byKey[folderKey{v, f}]
	if !ok {
		return domainvault.Folder{}, domain.ErrNotFound
	}
	return *out, nil
}
func (r *fakeFolderRepo) Update(_ context.Context, f domainvault.Folder) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := folderKey{f.VaultID, f.ID}
	if _, ok := r.byKey[k]; !ok {
		return domain.ErrNotFound
	}
	cp := f
	r.byKey[k] = &cp
	return nil
}
func (r *fakeFolderRepo) Delete(_ context.Context, v domainvault.ID, f domainvault.FolderID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.byKey, folderKey{v, f})
	return nil
}
func (r *fakeFolderRepo) List(_ context.Context, v domainvault.ID) ([]domainvault.Folder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []domainvault.Folder{}
	for k, f := range r.byKey {
		if k.vaultID == v {
			out = append(out, *f)
		}
	}
	return out, nil
}
