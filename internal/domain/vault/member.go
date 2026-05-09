// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// Member is the vault_members row modelled as a domain entity.
//
// Security-review additions:
//   - WrapSignature: Ed25519 signature by Sender's identity key binding
//     (VaultID, UserID, EncryptedVaultKey). (H1)
//   - SenderID: who wrapped the key for this recipient — needed to look up
//     the sender's identity public key during verification. (H1)
//   - RemovedAt: soft-delete marker; audit trail never loses membership
//     history. (M3)
//
// Wrap algorithm rules:
//   - Personal vaults: EncryptedVaultKey.Alg == AlgAES256KW (M4)
//   - Shared vaults:   EncryptedVaultKey.Alg == AlgRSAOAEPSHA256
type Member struct {
	VaultID            ID
	UserID             user.ID
	EncryptedVaultKey  crypto.EncryptedBlob
	SenderID           user.ID
	WrapSignature      crypto.Signature
	Role               user.Role
	RemovedAt          *time.Time
	AddedAt            time.Time
}

// Validate asserts the Member invariants. It does NOT verify the signature
// cryptographically — that's an infrastructure concern (M8 acceptance test).
func (m Member) Validate(vaultType Type) error {
	if m.VaultID.IsZero() {
		return domain.NewInvalid("vault_id", "required")
	}
	if m.UserID.IsZero() {
		return domain.NewInvalid("user_id", "required")
	}
	if err := m.EncryptedVaultKey.Validate(); err != nil {
		return domain.NewInvalid("encrypted_vault_key", err.Error())
	}

	switch vaultType {
	case TypePersonal:
		if m.EncryptedVaultKey.Alg != crypto.AlgAES256KW {
			return domain.NewInvalid("encrypted_vault_key", "personal vaults require AES-256-KW wrap (M4)")
		}
	case TypeShared:
		if m.EncryptedVaultKey.Alg != crypto.AlgRSAOAEPSHA256 {
			return domain.NewInvalid("encrypted_vault_key", "shared vaults require RSA-OAEP wrap")
		}
	}

	if m.SenderID.IsZero() {
		return domain.NewInvalid("sender_id", "required (H1)")
	}
	if m.WrapSignature.IsZero() {
		return domain.NewInvalid("wrap_signature", "required (H1)")
	}
	if !m.Role.IsValid() {
		return domain.NewInvalid("role", "invalid")
	}
	return nil
}

// IsActive reports whether the membership is current (not soft-deleted).
func (m Member) IsActive() bool { return m.RemovedAt == nil }

// Remove marks the membership as removed at the given instant. It returns a
// NEW Member — members are value objects; immutability is cheap and prevents
// accidental shared-state bugs in use cases.
func (m Member) Remove(at time.Time) Member {
	out := m
	out.RemovedAt = &at
	return out
}
