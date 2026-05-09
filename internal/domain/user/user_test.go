// SPDX-License-Identifier: AGPL-3.0-or-later

package user

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

func gcmBlob(t *testing.T) crypto.EncryptedBlob {
	t.Helper()
	return crypto.EncryptedBlob{
		Version:    crypto.V1,
		Alg:        crypto.AlgAES256GCM,
		Nonce:      bytes.Repeat([]byte{0xA1}, 12),
		Ciphertext: []byte("x"),
		Tag:        bytes.Repeat([]byte{0xB2}, 16),
	}
}

func validUser(t *testing.T) User {
	t.Helper()
	email, _ := NewEmail("user@example.com")
	pub, _ := crypto.NewPublicKey([]byte{0x30, 0x82})
	idPub, _ := crypto.NewPublicKey(bytes.Repeat([]byte{0x11}, 32))
	sig, _ := crypto.NewEd25519Signature(bytes.Repeat([]byte{0x22}, crypto.Ed25519SignatureSize))
	return User{
		ID:                          ID("user-1"),
		Email:                       email,
		Name:                        "Alice",
		Salt:                        bytes.Repeat([]byte{0x5A}, 16),
		KDFParams:                   DefaultKDFParams(),
		EncryptedPrivateKey:         gcmBlob(t),
		EncryptedIdentityPrivateKey: gcmBlob(t),
		PublicKey:                   pub,
		IdentityPublicKey:           idPub,
		PublicKeySignature:          sig,
		Role:                        RoleMember,
		CreatedAt:                   time.Now(),
	}
}

func TestUser_Validate_OK(t *testing.T) {
	t.Parallel()
	if err := validUser(t).Validate(); err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
}

func TestUser_Validate_Invariants(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		mutate func(*User)
		field  string
	}{
		{"empty id", func(u *User) { u.ID = "" }, "id"},
		{"empty email", func(u *User) { u.Email = Email{} }, "email"},
		{"empty name", func(u *User) { u.Name = "" }, "name"},
		{"name too long", func(u *User) { u.Name = strings.Repeat("x", 256) }, "name"},
		{"salt too short", func(u *User) { u.Salt = []byte{1, 2, 3} }, "salt"},
		{"bad kdf", func(u *User) { u.KDFParams.Iterations = 0 }, "kdf_iterations"},
		{"bad enc priv", func(u *User) { u.EncryptedPrivateKey = crypto.EncryptedBlob{} }, "encrypted_private_key"},
		{"bad enc id priv", func(u *User) { u.EncryptedIdentityPrivateKey = crypto.EncryptedBlob{} }, "encrypted_identity_private_key"},
		{"empty pubkey", func(u *User) { u.PublicKey = crypto.PublicKey{} }, "public_key"},
		{"empty id pubkey", func(u *User) { u.IdentityPublicKey = crypto.PublicKey{} }, "identity_public_key"},
		{"empty pk sig", func(u *User) { u.PublicKeySignature = crypto.Signature{} }, "public_key_signature"},
		{"bad role", func(u *User) { u.Role = Role("ghost") }, "role"},
		{"negative attempts", func(u *User) { u.FailedLoginAttempts = -1 }, "failed_login_attempts"},
	}
	for _, tc := range cases {
		u := validUser(t)
		tc.mutate(&u)
		err := u.Validate()
		if err == nil {
			t.Fatalf("%s: expected error", tc.name)
		}
		var inv *domain.Invalid
		if !errors.As(err, &inv) {
			t.Fatalf("%s: expected *domain.Invalid, got %T (%v)", tc.name, err, err)
		}
		if inv.Field != tc.field {
			t.Fatalf("%s: field=%q want %q", tc.name, inv.Field, tc.field)
		}
	}
}

func TestUser_IsLocked(t *testing.T) {
	t.Parallel()
	now := time.Now()
	future := now.Add(1 * time.Minute)
	past := now.Add(-1 * time.Minute)

	u := validUser(t)
	if u.IsLocked(now) {
		t.Fatalf("no LockedUntil -> not locked")
	}
	u.LockedUntil = &future
	if !u.IsLocked(now) {
		t.Fatalf("future LockedUntil -> locked")
	}
	u.LockedUntil = &past
	if u.IsLocked(now) {
		t.Fatalf("past LockedUntil -> not locked")
	}
}

func TestID(t *testing.T) {
	t.Parallel()
	var zero ID
	if !zero.IsZero() {
		t.Fatalf("zero ID must IsZero")
	}
	id := ID("x")
	if id.IsZero() {
		t.Fatalf("set ID must not IsZero")
	}
	if id.String() != "x" {
		t.Fatalf("String() broken")
	}
}

func TestKDFParams_Validate(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		p     KDFParams
		field string
	}{
		{"iter 0", KDFParams{Iterations: 0, MemoryKB: 65536, Parallelism: 4}, "kdf_iterations"},
		{"mem low", KDFParams{Iterations: 3, MemoryKB: 1024, Parallelism: 4}, "kdf_memory"},
		{"par 0", KDFParams{Iterations: 3, MemoryKB: 65536, Parallelism: 0}, "kdf_parallelism"},
	}
	for _, tc := range cases {
		err := tc.p.Validate()
		if err == nil {
			t.Fatalf("%s: expected error", tc.name)
		}
		var inv *domain.Invalid
		if !errors.As(err, &inv) || inv.Field != tc.field {
			t.Fatalf("%s: wrong field: %v", tc.name, err)
		}
	}
	if err := DefaultKDFParams().Validate(); err != nil {
		t.Fatalf("defaults must validate: %v", err)
	}
}
