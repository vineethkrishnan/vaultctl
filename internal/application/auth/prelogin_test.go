// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func seedUser(t *testing.T, repo *fakeUserRepo, email string) user.User {
	t.Helper()
	e, _ := user.NewEmail(email)
	u := user.User{
		ID:                          user.ID("u1"),
		Email:                       e,
		Name:                        "Alice",
		Salt:                        bytes.Repeat([]byte{0x5A}, 16),
		KDFParams:                   user.KDFParams{Iterations: 4, MemoryKB: 32768, Parallelism: 2},
		EncryptedPrivateKey:         validBlob(t),
		EncryptedIdentityPrivateKey: validBlob(t),
		PublicKey:                   validPublicKey(t),
		PublicKeySignature:          validSignature(t),
		IdentityPublicKey:           validPublicKey(t),
		Role:                        user.RoleMember,
		CreatedAt:                   time.Unix(1_700_000_000, 0).UTC(),
	}
	if err := repo.Create(context.Background(), u, "$fake$authhash"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return u
}

func TestPrelogin_KnownUser(t *testing.T) {
	t.Parallel()
	repo := newFakeUserRepo()
	u := seedUser(t, repo, "alice@example.com")
	uc := &Prelogin{Users: repo, HMAC: fakeHMAC{}}

	out, err := uc.Execute(context.Background(), PreloginInput{Email: "Alice@Example.com"})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !bytes.Equal(out.Salt, u.Salt) {
		t.Fatalf("salt mismatch: got %x want %x", out.Salt, u.Salt)
	}
	if out.Iterations != 4 || out.MemoryKB != 32768 || out.Parallelism != 2 {
		t.Fatalf("KDF params mismatch: %+v", out)
	}
}

func TestPrelogin_UnknownUser_FakeSalt_H2(t *testing.T) {
	t.Parallel()
	repo := newFakeUserRepo()
	uc := &Prelogin{Users: repo, HMAC: fakeHMAC{}}

	a, err := uc.Execute(context.Background(), PreloginInput{Email: "ghost@example.com"})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	// Determinism — two lookups of the same unknown email must produce the
	// SAME fake salt.
	b, _ := uc.Execute(context.Background(), PreloginInput{Email: "ghost@example.com"})
	if !bytes.Equal(a.Salt, b.Salt) {
		t.Fatalf("H2 fake salt not deterministic for same email")
	}
	// Different email -> different fake salt.
	c, _ := uc.Execute(context.Background(), PreloginInput{Email: "other@example.com"})
	if bytes.Equal(a.Salt, c.Salt) {
		t.Fatalf("H2 fake salts collided across emails")
	}

	// Shape parity: len(salt) and KDF params should match what we'd return
	// for a real user (default KDF).
	if len(a.Salt) != 32 {
		t.Fatalf("fake salt wrong size: %d", len(a.Salt))
	}
	def := user.DefaultKDFParams()
	if a.Iterations != def.Iterations || a.MemoryKB != def.MemoryKB || a.Parallelism != def.Parallelism {
		t.Fatalf("H2 defaults leaked: got %+v want %+v", a, def)
	}
}

func TestPrelogin_MalformedEmail_AlsoReturnsFakeSalt(t *testing.T) {
	t.Parallel()
	repo := newFakeUserRepo()
	uc := &Prelogin{Users: repo, HMAC: fakeHMAC{}}

	a, err := uc.Execute(context.Background(), PreloginInput{Email: "not-an-email"})
	if err != nil {
		t.Fatalf("malformed email must not error (H2): %v", err)
	}
	if len(a.Salt) == 0 {
		t.Fatalf("malformed email should still return a salt")
	}

	// Same bad input → same output (no timing channel via error paths).
	b, _ := uc.Execute(context.Background(), PreloginInput{Email: "not-an-email"})
	if !bytes.Equal(a.Salt, b.Salt) {
		t.Fatalf("malformed-email salt not deterministic")
	}
}

func TestPrelogin_CustomDefaultKDF(t *testing.T) {
	t.Parallel()
	repo := newFakeUserRepo()
	uc := &Prelogin{Users: repo, HMAC: fakeHMAC{}, DefaultKDF: user.KDFParams{Iterations: 5, MemoryKB: 65536, Parallelism: 3}}
	out, _ := uc.Execute(context.Background(), PreloginInput{Email: "ghost@example.com"})
	if out.Iterations != 5 {
		t.Fatalf("custom default not applied: %d", out.Iterations)
	}
	_ = crypto.V1 // keep import
}
