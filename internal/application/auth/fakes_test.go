// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"sync"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// frozenClock is a Clock that always returns the injected time.
type frozenClock struct{ t time.Time }

func (c *frozenClock) Now() time.Time { return c.t }

// incrementingIDs produces deterministic IDs: "id-1", "id-2", ...
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

// fakeHMAC is a deterministic HMAC with fixed peppers, usable as a ports.HMACer.
type fakeHMAC struct{}

func (fakeHMAC) sign(pepper, in []byte) []byte {
	m := hmac.New(sha256.New, pepper)
	m.Write(in)
	return m.Sum(nil)
}
func (h fakeHMAC) Hash(in []byte) []byte       { return h.sign([]byte("server-pepper"), in) }
func (h fakeHMAC) HashString(in string) []byte { return h.Hash([]byte(in)) }
func (h fakeHMAC) Equal(a, b []byte) bool      { return hmac.Equal(a, b) }
func (h fakeHMAC) EnumerationSalt(email string) []byte {
	return h.sign([]byte("enum-pepper"), []byte(email))
}

// fakeHasher is a test-only AuthHasher: "hashes" by base64-encoding + fixed
// prefix. Determinism is what we want in tests.
type fakeHasher struct {
	upgradeOnVerify bool
	failOnHash      bool
}

func (h *fakeHasher) Hash(input []byte) (string, error) {
	if h.failOnHash {
		return "", errors.New("fake hasher: hash failed")
	}
	return "$fake$" + string(input), nil
}
func (h *fakeHasher) Verify(input []byte, encoded string) (ok, upgrade bool, err error) {
	return encoded == "$fake$"+string(input), h.upgradeOnVerify, nil
}

// fakeTokenIssuer mints opaque strings.
type fakeTokenIssuer struct {
	issued []string
	fail   bool
}

func (f *fakeTokenIssuer) Issue(userID, role string, _ time.Time, _ time.Time) (string, error) {
	if f.fail {
		return "", errors.New("fake token issuer: fail")
	}
	out := "access:" + userID + ":" + role
	f.issued = append(f.issued, out)
	return out, nil
}
func (f *fakeTokenIssuer) Verify(token string) (ports.AccessClaims, error) {
	return ports.AccessClaims{}, errors.New("not used in these tests")
}

// fakeTokenGen returns pre-programmed tokens in order.
type fakeTokenGen struct {
	refresh                 []string
	apiKey                  []string
	invite                  []string
	refreshI, apiI, inviteI int
	fail                    bool
}

func (f *fakeTokenGen) RefreshToken() (string, error) {
	if f.fail {
		return "", errors.New("fake refresh: fail")
	}
	if f.refreshI >= len(f.refresh) {
		return "refresh-x", nil
	}
	t := f.refresh[f.refreshI]
	f.refreshI++
	return t, nil
}
func (f *fakeTokenGen) APIKey() (string, error)      { return "vk_deadbeef", nil }
func (f *fakeTokenGen) InviteToken() (string, error) { return "invite-xyz", nil }

// fakeUserRepo is a minimal in-memory UserRepository for use-case tests.
type fakeUserRepo struct {
	mu       sync.Mutex
	byID     map[user.ID]*user.User
	byEmail  map[string]user.ID
	authHash map[user.ID]string
	failOps  map[string]error // per-method injected failures
}

func newFakeUserRepo() *fakeUserRepo {
	return &fakeUserRepo{
		byID:     map[user.ID]*user.User{},
		byEmail:  map[string]user.ID{},
		authHash: map[user.ID]string{},
		failOps:  map[string]error{},
	}
}

func (r *fakeUserRepo) Create(_ context.Context, u user.User, authHash string) error {
	if err := r.failOps["Create"]; err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.byEmail[u.Email.String()]; dup {
		return domain.ErrConflict
	}
	cp := u
	r.byID[u.ID] = &cp
	r.byEmail[u.Email.String()] = u.ID
	r.authHash[u.ID] = authHash
	return nil
}
func (r *fakeUserRepo) FindByEmail(_ context.Context, e user.Email) (user.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	id, ok := r.byEmail[e.String()]
	if !ok {
		return user.User{}, domain.ErrNotFound
	}
	return *r.byID[id], nil
}
func (r *fakeUserRepo) FindByID(_ context.Context, id user.ID) (user.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	u, ok := r.byID[id]
	if !ok {
		return user.User{}, domain.ErrNotFound
	}
	return *u, nil
}
func (r *fakeUserRepo) AuthHash(_ context.Context, id user.ID) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	h, ok := r.authHash[id]
	if !ok {
		return "", domain.ErrNotFound
	}
	return h, nil
}
func (r *fakeUserRepo) UpdateProfile(_ context.Context, id user.ID, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	u, ok := r.byID[id]
	if !ok {
		return domain.ErrNotFound
	}
	u.Name = name
	return nil
}
func (r *fakeUserRepo) SetLocale(_ context.Context, id user.ID, locale string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	u, ok := r.byID[id]
	if !ok {
		return domain.ErrNotFound
	}
	u.Locale = user.NormalizeLocale(locale)
	return nil
}

func (r *fakeUserRepo) SetTimezone(_ context.Context, id user.ID, timezone string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	u, ok := r.byID[id]
	if !ok {
		return domain.ErrNotFound
	}
	u.Timezone = user.NormalizeTimezone(timezone)
	return nil
}
func (r *fakeUserRepo) UpdateAuthHash(_ context.Context, id user.ID, authHash string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.byID[id]; !ok {
		return domain.ErrNotFound
	}
	r.authHash[id] = authHash
	return nil
}
func (r *fakeUserRepo) ApplyFailedLogin(_ context.Context, id user.ID, attempts int, lockedUntil *time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	u, ok := r.byID[id]
	if !ok {
		return domain.ErrNotFound
	}
	u.FailedLoginAttempts = attempts
	u.LockedUntil = lockedUntil
	return nil
}
func (r *fakeUserRepo) ResetLoginFailures(_ context.Context, id user.ID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	u, ok := r.byID[id]
	if !ok {
		return domain.ErrNotFound
	}
	u.FailedLoginAttempts = 0
	u.LockedUntil = nil
	return nil
}
func (r *fakeUserRepo) UpdateTOTPCounter(_ context.Context, _ user.ID, _ int64) error {
	return nil
}
func (r *fakeUserRepo) SetTOTPSecret(_ context.Context, _ user.ID, _ []byte) error {
	return nil
}
func (r *fakeUserRepo) GetTOTPSecret(_ context.Context, _ user.ID) ([]byte, int64, error) {
	return nil, 0, nil
}
func (r *fakeUserRepo) EnableTOTP(_ context.Context, _ user.ID) error {
	return nil
}
func (r *fakeUserRepo) DisableTOTP(_ context.Context, _ user.ID) error {
	return nil
}
func (r *fakeUserRepo) UpdatePasswordMaterial(_ context.Context, _ user.ID, _ string, _, _ []byte) error {
	return nil
}
func (r *fakeUserRepo) GetHint(_ context.Context, _ user.Email) ([]byte, error) {
	return nil, domain.ErrNotFound
}
func (r *fakeUserRepo) GetRecoveryMaterial(ctx context.Context, email user.Email) (user.User, error) {
	return r.FindByEmail(ctx, email)
}
func (r *fakeUserRepo) UpdatePasswordMaterialAndHint(_ context.Context, _ user.ID, _ string, _, _, _ []byte) error {
	return nil
}
func (r *fakeUserRepo) UpdateRecoveryWrappedKeys(_ context.Context, _ user.ID, _, _ []byte) error {
	return nil
}
func (r *fakeUserRepo) CountAll(_ context.Context) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.byEmail), nil
}
func (r *fakeUserRepo) MarkEmailVerified(_ context.Context, id user.ID, at time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if u, ok := r.byID[id]; ok {
		u.EmailVerified = true
		u.EmailVerifiedAt = &at
	}
	return nil
}

// fakeSessionStore is an in-memory SessionStore.
type fakeSessionStore struct {
	mu      sync.Mutex
	byID    map[user.SessionID]*user.Session
	byHash  map[string]user.SessionID
	failOps map[string]error
}

func newFakeSessionStore() *fakeSessionStore {
	return &fakeSessionStore{
		byID:    map[user.SessionID]*user.Session{},
		byHash:  map[string]user.SessionID{},
		failOps: map[string]error{},
	}
}

func (s *fakeSessionStore) Create(_ context.Context, sess user.Session) error {
	if err := s.failOps["Create"]; err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := sess
	s.byID[sess.ID] = &cp
	s.byHash[string(sess.TokenHash.Bytes())] = sess.ID
	return nil
}
func (s *fakeSessionStore) FindByTokenHash(_ context.Context, h user.RefreshTokenHash) (user.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.byHash[string(h.Bytes())]
	if !ok {
		return user.Session{}, domain.ErrNotFound
	}
	return *s.byID[id], nil
}
func (s *fakeSessionStore) Revoke(_ context.Context, id user.SessionID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.byID[id]
	if !ok {
		return nil
	}
	delete(s.byHash, string(sess.TokenHash.Bytes()))
	delete(s.byID, id)
	return nil
}
func (s *fakeSessionStore) Rotate(_ context.Context, id user.SessionID, newHash user.RefreshTokenHash, at, expiresAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.byID[id]
	if !ok {
		return domain.ErrNotFound
	}
	delete(s.byHash, string(sess.TokenHash.Bytes()))
	sess.TokenHash = newHash
	sess.ExpiresAt = expiresAt
	sess.LastRefreshAt = &at
	s.byHash[string(newHash.Bytes())] = id
	return nil
}
func (s *fakeSessionStore) RevokeAllForUser(_ context.Context, _ user.ID) error { return nil }
func (s *fakeSessionStore) RevokeByDevice(_ context.Context, _ user.ID, _ string) error {
	return nil
}
func (s *fakeSessionStore) PurgeExpired(_ context.Context) (int, error) { return 0, nil }
func (s *fakeSessionStore) ListForUser(_ context.Context, _ user.ID) ([]user.Session, error) {
	return nil, nil
}

// emptyVaultRepo satisfies ports.VaultRepository for login tests. Returns no
// vaults so the login path exercises only auth mechanics, not vault loading.
type emptyVaultRepo struct{}

func (emptyVaultRepo) Create(_ context.Context, _ vault.Vault, _ vault.Member) error {
	return nil
}
func (emptyVaultRepo) Get(_ context.Context, _ vault.ID) (vault.Vault, error) {
	return vault.Vault{}, nil
}
func (emptyVaultRepo) ListForUser(_ context.Context, _ user.ID) ([]vault.Vault, error) {
	return nil, nil
}
func (emptyVaultRepo) IsActiveMember(_ context.Context, _ user.ID, _ vault.ID) (user.Role, bool, error) {
	return "", false, nil
}
func (emptyVaultRepo) AddMember(_ context.Context, _ vault.Member) error { return nil }
func (emptyVaultRepo) RemoveMember(_ context.Context, _ vault.ID, _ user.ID) error {
	return nil
}
func (emptyVaultRepo) UpdateMemberRole(_ context.Context, _ vault.ID, _ user.ID, _ user.Role) error {
	return nil
}
func (emptyVaultRepo) ListMembers(_ context.Context, _ vault.ID) ([]vault.Member, error) {
	return nil, nil
}
func (emptyVaultRepo) MemberForUser(_ context.Context, _ vault.ID, _ user.ID) (vault.Member, error) {
	return vault.Member{}, nil
}
func (emptyVaultRepo) ListSharedByOrgMember(_ context.Context, _ organization.ID, _ user.ID) ([]vault.ID, error) {
	return nil, nil
}
func (emptyVaultRepo) Delete(_ context.Context, _ vault.ID) error { return nil }
