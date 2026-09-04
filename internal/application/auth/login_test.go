// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

func newLogin(t *testing.T) (*Login, *fakeUserRepo, *fakeSessionStore, *fakeHasher) {
	t.Helper()
	repo := newFakeUserRepo()
	sess := newFakeSessionStore()
	hasher := &fakeHasher{}
	clock := &frozenClock{t: time.Unix(1_700_000_000, 0).UTC()}
	return &Login{
		Users:           repo,
		Sessions:        sess,
		Vaults:          emptyVaultRepo{},
		Hasher:          hasher,
		Tokens:          &fakeTokenIssuer{},
		TokenGenerator:  &fakeTokenGen{refresh: []string{"rtok-1", "rtok-2"}},
		HMAC:            fakeHMAC{},
		Clock:           clock,
		IDs:             &incrementingIDs{},
		MaxAttempts:     3,
		LockoutDuration: 15 * time.Minute,
		RefreshTTL:      7 * 24 * time.Hour,
	}, repo, sess, hasher
}

func TestLogin_HappyPath(t *testing.T) {
	t.Parallel()
	uc, repo, _, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")

	out, err := uc.Execute(context.Background(), LoginInput{
		Email:      "alice@example.com",
		AuthHash:   []byte("authhash"),
		DeviceName: "laptop",
		IPAddress:  "10.0.0.0/24",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if out.UserID != "u1" {
		t.Fatalf("wrong user id: %v", out.UserID)
	}
	if out.AccessToken == "" || out.RefreshToken == "" || out.SessionID == "" {
		t.Fatalf("missing tokens: %+v", out)
	}
	if out.UpgradeAuthHash {
		t.Fatalf("should not flag upgrade when hasher reports none")
	}
}

func TestLogin_WrongPassword_CountsAttempts(t *testing.T) {
	t.Parallel()
	uc, repo, _, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")

	in := LoginInput{Email: "alice@example.com", AuthHash: []byte("WRONG")}
	for i := 1; i <= 2; i++ {
		_, err := uc.Execute(context.Background(), in)
		if !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("attempt %d: expected ErrInvalidCredentials, got %v", i, err)
		}
	}

	// 3rd attempt hits MaxAttempts, transitions to locked.
	_, err := uc.Execute(context.Background(), in)
	if !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("third attempt: expected ErrAccountLocked, got %v", err)
	}

	// 4th attempt (even with the right password) is refused by lockout.
	in.AuthHash = []byte("authhash")
	_, err = uc.Execute(context.Background(), in)
	if !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("post-lock attempt: expected ErrAccountLocked, got %v", err)
	}
}

func TestLogin_SuccessResetsCounters(t *testing.T) {
	t.Parallel()
	uc, repo, _, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")

	// One failed attempt
	_, _ = uc.Execute(context.Background(), LoginInput{Email: "alice@example.com", AuthHash: []byte("bad")})

	// Successful login resets
	_, err := uc.Execute(context.Background(), LoginInput{Email: "alice@example.com", AuthHash: []byte("authhash")})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	u, _ := repo.FindByID(context.Background(), "u1")
	if u.FailedLoginAttempts != 0 || u.LockedUntil != nil {
		t.Fatalf("counters not reset: %+v", u)
	}
}

func TestLogin_UnknownEmail_InvalidCredentials(t *testing.T) {
	t.Parallel()
	uc, _, _, _ := newLogin(t)
	_, err := uc.Execute(context.Background(), LoginInput{Email: "nobody@example.com", AuthHash: []byte("x")})
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestLogin_BadEmailFormat_InvalidCredentials(t *testing.T) {
	t.Parallel()
	uc, _, _, _ := newLogin(t)
	_, err := uc.Execute(context.Background(), LoginInput{Email: "not-an-email"})
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestLogin_UpgradeFlag(t *testing.T) {
	t.Parallel()
	uc, repo, _, hasher := newLogin(t)
	seedUser(t, repo, "alice@example.com")
	hasher.upgradeOnVerify = true

	out, err := uc.Execute(context.Background(), LoginInput{Email: "alice@example.com", AuthHash: []byte("authhash")})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !out.UpgradeAuthHash {
		t.Fatalf("expected UpgradeAuthHash=true")
	}
}

func TestLogin_SessionPersisted(t *testing.T) {
	t.Parallel()
	uc, repo, sess, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")

	out, err := uc.Execute(context.Background(), LoginInput{
		Email: "alice@example.com", AuthHash: []byte("authhash"), DeviceName: "mac",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	// We can look the session up by the HMAC of the returned refresh token.
	hashBytes := fakeHMAC{}.HashString(out.RefreshToken)
	// Verify presence by iterating byHash (encapsulation-ok for the fake).
	found := false
	for h := range sess.byHash {
		if h == string(hashBytes) {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("session not persisted under expected hash")
	}
}

func TestLogin_TokenIssuerFailure(t *testing.T) {
	t.Parallel()
	uc, repo, _, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")
	uc.Tokens = &fakeTokenIssuer{fail: true}
	_, err := uc.Execute(context.Background(), LoginInput{Email: "alice@example.com", AuthHash: []byte("authhash")})
	if err == nil || !strings.Contains(err.Error(), "issue access token") {
		t.Fatalf("expected token issuer wrapping, got %v", err)
	}
}

func TestLogin_RefreshGenFailure(t *testing.T) {
	t.Parallel()
	uc, repo, _, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")
	uc.TokenGenerator = &fakeTokenGen{fail: true}
	_, err := uc.Execute(context.Background(), LoginInput{Email: "alice@example.com", AuthHash: []byte("authhash")})
	if err == nil || !strings.Contains(err.Error(), "gen refresh token") {
		t.Fatalf("expected refresh gen wrapping, got %v", err)
	}
}

// C4: authHash should never leak - demonstrate that it's not attached to
// any output the use case returns. We verify the invariant by inspecting
// the LoginOutput (has no authHash field by design).
func TestLogin_AuthHashNotInOutput_C4(t *testing.T) {
	t.Parallel()
	uc, repo, _, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")
	// Overwrite the stored hash so SECRET-AUTH-HASH is the accepted input.
	if err := repo.UpdateAuthHash(context.Background(), "u1", "$fake$SECRET-AUTH-HASH"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	out, err := uc.Execute(context.Background(), LoginInput{Email: "alice@example.com", AuthHash: []byte("SECRET-AUTH-HASH")})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	// The auth hash must not appear anywhere in LoginOutput.
	dump := fmt.Sprintf("%+v", out)
	if strings.Contains(dump, "SECRET-AUTH-HASH") {
		t.Fatalf("authHash leaked into LoginOutput: %s", dump)
	}
}

// sharedVaultRepo serves one shared vault whose key was wrapped by senderID.
type sharedVaultRepo struct {
	emptyVaultRepo
	senderID user.ID
}

func (r sharedVaultRepo) ListForUser(_ context.Context, _ user.ID) ([]vault.Vault, error) {
	return []vault.Vault{{ID: vault.ID("v1"), Name: "Team", Type: vault.TypeShared}}, nil
}

func (r sharedVaultRepo) MemberForUser(_ context.Context, vaultID vault.ID, userID user.ID) (vault.Member, error) {
	return vault.Member{
		VaultID:  vaultID,
		UserID:   userID,
		SenderID: r.senderID,
		Role:     user.RoleMember,
	}, nil
}

func seedSender(t *testing.T, repo *fakeUserRepo, id user.ID, email string, identityKey crypto.PublicKey) {
	t.Helper()
	e, _ := user.NewEmail(email)
	u := user.User{
		ID:                          id,
		Email:                       e,
		Name:                        "Bob",
		Salt:                        bytes.Repeat([]byte{0x5B}, 16),
		KDFParams:                   user.KDFParams{Iterations: 4, MemoryKB: 32768, Parallelism: 2},
		EncryptedPrivateKey:         validBlob(t),
		EncryptedIdentityPrivateKey: validBlob(t),
		PublicKey:                   validPublicKey(t),
		PublicKeySignature:          validSignature(t),
		IdentityPublicKey:           identityKey,
		Role:                        user.RoleMember,
		CreatedAt:                   time.Unix(1_700_000_000, 0).UTC(),
	}
	if err := repo.Create(context.Background(), u, "$fake$authhash"); err != nil {
		t.Fatalf("seed sender: %v", err)
	}
}

func TestLogin_AttachesSenderIdentityKeyForSharedVault(t *testing.T) {
	t.Parallel()
	uc, repo, _, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")
	senderKey, _ := crypto.NewPublicKey(bytes.Repeat([]byte{0x33}, 32))
	seedSender(t, repo, user.ID("u2"), "bob@example.com", senderKey)
	uc.Vaults = sharedVaultRepo{senderID: user.ID("u2")}

	out, err := uc.Execute(context.Background(), LoginInput{
		Email: "alice@example.com", AuthHash: []byte("authhash"),
		DeviceName: "laptop", IPAddress: "10.0.0.0/24",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if len(out.Vaults) != 1 {
		t.Fatalf("want 1 vault, got %d", len(out.Vaults))
	}
	// Without this the client cannot check the wrap signature at all (H1).
	if !bytes.Equal(out.Vaults[0].SenderIdentityPublicKey.Bytes(), senderKey.Bytes()) {
		t.Fatalf("wrong sender identity key: %x", out.Vaults[0].SenderIdentityPublicKey.Bytes())
	}
}

func TestLogin_SelfWrappedVaultUsesOwnIdentityKey(t *testing.T) {
	t.Parallel()
	uc, repo, _, _ := newLogin(t)
	u := seedUser(t, repo, "alice@example.com")
	uc.Vaults = sharedVaultRepo{senderID: u.ID}

	out, err := uc.Execute(context.Background(), LoginInput{
		Email: "alice@example.com", AuthHash: []byte("authhash"),
		DeviceName: "laptop", IPAddress: "10.0.0.0/24",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !bytes.Equal(out.Vaults[0].SenderIdentityPublicKey.Bytes(), u.IdentityPublicKey.Bytes()) {
		t.Fatalf("self-wrap should reuse the caller's own identity key")
	}
}

func TestLogin_UnknownSenderFailsClosed(t *testing.T) {
	t.Parallel()
	uc, repo, _, _ := newLogin(t)
	seedUser(t, repo, "alice@example.com")
	uc.Vaults = sharedVaultRepo{senderID: user.ID("ghost")}

	_, err := uc.Execute(context.Background(), LoginInput{
		Email: "alice@example.com", AuthHash: []byte("authhash"),
		DeviceName: "laptop", IPAddress: "10.0.0.0/24",
	})
	if err == nil {
		t.Fatal("want an error when the sender cannot be resolved")
	}
}
