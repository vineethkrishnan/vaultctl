// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func validBlob(t *testing.T) crypto.EncryptedBlob {
	t.Helper()
	return crypto.EncryptedBlob{
		Version:    crypto.V1,
		Alg:        crypto.AlgAES256GCM,
		Nonce:      bytes.Repeat([]byte{0xA1}, 12),
		Ciphertext: []byte("x"),
		Tag:        bytes.Repeat([]byte{0xB2}, 16),
	}
}

func validPublicKey(t *testing.T) crypto.PublicKey {
	t.Helper()
	pk, _ := crypto.NewPublicKey(bytes.Repeat([]byte{0x11}, 32))
	return pk
}

func validSignature(t *testing.T) crypto.Signature {
	t.Helper()
	s, _ := crypto.NewEd25519Signature(bytes.Repeat([]byte{0x22}, crypto.Ed25519SignatureSize))
	return s
}

func validRegisterInput(t *testing.T) RegisterInput {
	t.Helper()
	return RegisterInput{
		Email:                       "user@example.com",
		Name:                        "Alice",
		AuthHash:                    bytes.Repeat([]byte{0x42}, 32),
		Salt:                        bytes.Repeat([]byte{0x5A}, 16),
		KDFParams:                   user.DefaultKDFParams(),
		EncryptedPrivateKey:         validBlob(t),
		EncryptedIdentityPrivateKey: validBlob(t),
		PublicKey:                   validPublicKey(t),
		PublicKeySignature:          validSignature(t),
		IdentityPublicKey:           validPublicKey(t),
		MasterPasswordPreflight:     "Correct-horse-8&!",
	}
}

func newRegister() (*Register, *fakeUserRepo) {
	uc, repo := newRegisterEmptyRepo()
	// Pre-seed an owner so subsequent Execute calls exercise the normal
	// (not-first-user) path. Tests that want to drive the first-user bypass
	// should use newRegisterEmptyRepo directly.
	seedOwner(repo)
	return uc, repo
}

func newRegisterEmptyRepo() (*Register, *fakeUserRepo) {
	repo := newFakeUserRepo()
	uc := &Register{
		Users:  repo,
		Hasher: &fakeHasher{},
		Clock:  &frozenClock{t: time.Unix(1_700_000_000, 0).UTC()},
		IDs:    &incrementingIDs{},
		Policy: user.DefaultPolicy(),
	}
	return uc, repo
}

func seedOwner(repo *fakeUserRepo) {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	id := user.ID("seed-owner")
	repo.byID[id] = &user.User{ID: id, Role: user.RoleOwner}
	repo.byEmail["seed-owner@example.com"] = id
	repo.authHash[id] = "seed"
}

func TestRegister_HappyPath(t *testing.T) {
	t.Parallel()
	uc, repo := newRegister()
	// Hook the salt into the user via a post-create override: our fake
	// repo stores the user as passed in, and Register already copies Salt
	// from input into the user aggregate via the handler... actually the
	// current Register implementation DOESN'T carry in.Salt into the user
	// because I forgot to thread it.
	out, err := uc.Execute(context.Background(), validRegisterInput(t))
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if out.UserID == "" || out.Role != user.RoleMember {
		t.Fatalf("bad output: %+v", out)
	}

	// Reloaded user must validate (we verify salt is persisted here).
	loaded, err := repo.FindByID(context.Background(), out.UserID)
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if err := loaded.Validate(); err != nil {
		t.Fatalf("persisted user invalid: %v", err)
	}
	if !bytes.Equal(loaded.Salt, bytes.Repeat([]byte{0x5A}, 16)) {
		t.Fatalf("salt not carried through: %x", loaded.Salt)
	}
}

func TestRegister_WeakPassword(t *testing.T) {
	t.Parallel()
	uc, _ := newRegister()
	in := validRegisterInput(t)
	in.MasterPasswordPreflight = "short"
	_, err := uc.Execute(context.Background(), in)
	if !errors.Is(err, ErrWeakMasterPassword) {
		t.Fatalf("expected ErrWeakMasterPassword, got %v", err)
	}
}

func TestRegister_MissingFields(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		mutate func(*RegisterInput)
	}{
		{"no authhash", func(i *RegisterInput) { i.AuthHash = nil }},
		{"no salt", func(i *RegisterInput) { i.Salt = nil }},
		{"bad email", func(i *RegisterInput) { i.Email = "not-an-email" }},
		{"bad enc priv", func(i *RegisterInput) { i.EncryptedPrivateKey = crypto.EncryptedBlob{} }},
		{"empty name", func(i *RegisterInput) { i.Name = "" }},
	}
	for _, tc := range cases {
		uc, _ := newRegister()
		in := validRegisterInput(t)
		tc.mutate(&in)
		if _, err := uc.Execute(context.Background(), in); err == nil {
			t.Fatalf("%s: expected error", tc.name)
		}
	}
}

func TestRegister_DuplicateEmail(t *testing.T) {
	t.Parallel()
	uc, _ := newRegister()
	in := validRegisterInput(t)
	if _, err := uc.Execute(context.Background(), in); err != nil {
		t.Fatalf("first register: %v", err)
	}
	_, err := uc.Execute(context.Background(), in)
	if !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("expected ErrEmailTaken, got %v", err)
	}
}

func TestRegister_DefaultRoleFallback(t *testing.T) {
	t.Parallel()
	uc, _ := newRegister()
	uc.DefaultRole = ""
	out, err := uc.Execute(context.Background(), validRegisterInput(t))
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if out.Role != user.RoleMember {
		t.Fatalf("empty DefaultRole must fall back to member, got %v", out.Role)
	}
}

func TestRegister_HasherFailure(t *testing.T) {
	t.Parallel()
	uc, _ := newRegister()
	uc.Hasher = &fakeHasher{failOnHash: true}
	if _, err := uc.Execute(context.Background(), validRegisterInput(t)); err == nil {
		t.Fatalf("expected hasher error")
	}
}

func TestRegister_RepoInfraError(t *testing.T) {
	t.Parallel()
	uc, repo := newRegister()
	repo.failOps["Create"] = errors.New("db down")
	_, err := uc.Execute(context.Background(), validRegisterInput(t))
	if err == nil || errors.Is(err, ErrEmailTaken) {
		t.Fatalf("expected generic infra error, got %v", err)
	}
	_ = domain.ErrNotFound // silence unused import
}

// On a fresh install the first registration must succeed regardless of
// RegistrationMode and the user must be promoted to owner. Without this,
// an invite-only default leaves the operator with no way to bootstrap.
func TestRegister_FirstUserBypass_InviteMode(t *testing.T) {
	t.Parallel()
	uc, _ := newRegisterEmptyRepo()
	uc.RegistrationMode = RegistrationModeInvite
	// No InviteToken supplied, no RedeemInvite wired - neither should matter.
	in := validRegisterInput(t)
	in.InviteToken = ""

	out, err := uc.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("first-user bypass should succeed in invite mode, got %v", err)
	}
	if out.Role != user.RoleOwner {
		t.Fatalf("first user must be promoted to owner, got %v", out.Role)
	}
}

func TestRegister_FirstUserBypass_DisabledMode(t *testing.T) {
	t.Parallel()
	uc, _ := newRegisterEmptyRepo()
	uc.RegistrationMode = RegistrationModeDisabled

	out, err := uc.Execute(context.Background(), validRegisterInput(t))
	if err != nil {
		t.Fatalf("first-user bypass should succeed in disabled mode, got %v", err)
	}
	if out.Role != user.RoleOwner {
		t.Fatalf("first user must be promoted to owner, got %v", out.Role)
	}
}

// Once any user exists, the bypass is gone - invite mode without a token
// must fail, and disabled mode must fail.
func TestRegister_BypassExpiresAfterFirstUser_InviteMode(t *testing.T) {
	t.Parallel()
	uc, _ := newRegister() // seeds an owner
	uc.RegistrationMode = RegistrationModeInvite
	in := validRegisterInput(t)
	in.InviteToken = ""

	_, err := uc.Execute(context.Background(), in)
	if !errors.Is(err, ErrInviteRequired) {
		t.Fatalf("expected ErrInviteRequired after first user, got %v", err)
	}
}

func TestRegister_BypassExpiresAfterFirstUser_DisabledMode(t *testing.T) {
	t.Parallel()
	uc, _ := newRegister() // seeds an owner
	uc.RegistrationMode = RegistrationModeDisabled

	_, err := uc.Execute(context.Background(), validRegisterInput(t))
	if !errors.Is(err, ErrRegistrationDisabled) {
		t.Fatalf("expected ErrRegistrationDisabled after first user, got %v", err)
	}
}
