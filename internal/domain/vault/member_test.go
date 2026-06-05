// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"errors"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func validMember(t *testing.T, blob crypto.EncryptedBlob) Member {
	t.Helper()
	return Member{
		VaultID:           ID("v1"),
		UserID:            user.ID("u1"),
		EncryptedVaultKey: blob,
		SenderID:          user.ID("sender"),
		WrapSignature:     ed25519Sig(t),
		Role:              user.RoleMember,
		AddedAt:           time.Now(),
	}
}

func TestMember_Validate_OK(t *testing.T) {
	t.Parallel()
	// Personal vault ↔ AES-KW (M4)
	if err := validMember(t, kwBlob(t)).Validate(TypePersonal); err != nil {
		t.Fatalf("personal KW valid: %v", err)
	}
	// Shared vault ↔ RSA-OAEP
	if err := validMember(t, rsaBlob(t)).Validate(TypeShared); err != nil {
		t.Fatalf("shared RSA valid: %v", err)
	}
}

func TestMember_Validate_AlgorithmBinding(t *testing.T) {
	t.Parallel()
	// Shared vault MUST NOT use AES-KW
	if err := validMember(t, kwBlob(t)).Validate(TypeShared); err == nil {
		t.Fatalf("shared+KW should fail (H1/M4 crossover)")
	}
	// Personal vault MUST NOT use RSA-OAEP
	if err := validMember(t, rsaBlob(t)).Validate(TypePersonal); err == nil {
		t.Fatalf("personal+RSA should fail (M4)")
	}
}

func TestMember_Validate_Invariants(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		mutate func(*Member)
		field  string
	}{
		{"empty vault", func(m *Member) { m.VaultID = "" }, "vault_id"},
		{"empty user", func(m *Member) { m.UserID = "" }, "user_id"},
		{"bad blob", func(m *Member) { m.EncryptedVaultKey = crypto.EncryptedBlob{} }, "encrypted_vault_key"},
		{"empty sender", func(m *Member) { m.SenderID = "" }, "sender_id"},
		{"no signature", func(m *Member) { m.WrapSignature = crypto.Signature{} }, "wrap_signature"},
		{"bad role", func(m *Member) { m.Role = user.Role("ghost") }, "role"},
	}
	for _, tc := range cases {
		m := validMember(t, kwBlob(t))
		tc.mutate(&m)
		err := m.Validate(TypePersonal)
		if err == nil {
			t.Fatalf("%s: expected error", tc.name)
		}
		var inv *domain.Invalid
		if !errors.As(err, &inv) || inv.Field != tc.field {
			t.Fatalf("%s: got %v", tc.name, err)
		}
	}
}

func TestMember_IsActive_RemoveImmutable(t *testing.T) {
	t.Parallel()
	m := validMember(t, kwBlob(t))
	if !m.IsActive() {
		t.Fatalf("fresh member should be active")
	}
	now := time.Now()
	removed := m.Remove(now)
	if !m.IsActive() {
		t.Fatalf("original member mutated - should be immutable")
	}
	if removed.IsActive() {
		t.Fatalf("removed member should not be active")
	}
	if removed.RemovedAt == nil || !removed.RemovedAt.Equal(now) {
		t.Fatalf("RemovedAt not set correctly")
	}
}
