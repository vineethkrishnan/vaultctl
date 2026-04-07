package vault

import (
	"context"
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// ShareVaultInput adds a member to an existing shared vault. Caller must
// hold admin+ role in the vault.
//
// Security wiring:
//   - H1: wrap_signature is signed by the SENDER's identity key over
//     (vault_id || recipient_user_id || encrypted_vault_key). The client
//     has already produced this signature; the server stores it verbatim.
//   - C1: the recipient client verifies wrap_signature against the
//     sender's PINNED identity key on read (Login). The server only
//     stores; it does not verify.
//   - M4: shared vaults use RSA-OAEP wrapping (validated by Member.Validate).
type ShareVaultInput struct {
	Caller            user.ID
	VaultID           domainvault.ID
	RecipientUserID   user.ID
	EncryptedVaultKey crypto.EncryptedBlob
	WrapSignature     crypto.Signature
	Role              user.Role
}

// ShareVault adds a new member to a shared vault.
type ShareVault struct {
	Vaults ports.VaultRepository
	Clock  ports.Clock
}

// Execute runs the use case.
func (uc *ShareVault) Execute(ctx context.Context, in ShareVaultInput) error {
	callerRole, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID)
	if err != nil {
		return err
	}
	if err := ensureRoleAtLeast(callerRole, user.RoleAdmin); err != nil {
		return err
	}
	v, err := uc.Vaults.Get(ctx, in.VaultID)
	if err != nil {
		return err
	}
	if v.Type != domainvault.TypeShared {
		return domain.NewInvalid("vault", "cannot share a personal vault")
	}
	member := domainvault.Member{
		VaultID:           in.VaultID,
		UserID:            in.RecipientUserID,
		EncryptedVaultKey: in.EncryptedVaultKey,
		SenderID:          in.Caller,
		WrapSignature:     in.WrapSignature,
		Role:              in.Role,
		AddedAt:           uc.Clock.Now(),
	}
	if err := member.Validate(v.Type); err != nil {
		return err
	}
	return uc.Vaults.AddMember(ctx, member)
}

// RemoveMemberInput soft-deletes a membership and signals the client-driven
// rekey (C2 — unconditional: ANY removal or role downgrade triggers rekey).
type RemoveMemberInput struct {
	Caller     user.ID
	VaultID    domainvault.ID
	TargetUser user.ID
}

// RemoveMemberOutput tells the admin client which items need re-encryption.
type RemoveMemberOutput struct {
	RemainingMembers []domainvault.Member
	// RekeyRequired is always true (C2) — kept as a boolean for clarity at
	// the handler layer.
	RekeyRequired bool
}

// RemoveMember removes a member from a shared vault.
type RemoveMember struct {
	Vaults ports.VaultRepository
}

// Execute runs the use case. After this call, the admin client performs
// the full rekey (see RekeyVault below).
func (uc *RemoveMember) Execute(ctx context.Context, in RemoveMemberInput) (RemoveMemberOutput, error) {
	callerRole, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID)
	if err != nil {
		return RemoveMemberOutput{}, err
	}
	if err := ensureRoleAtLeast(callerRole, user.RoleAdmin); err != nil {
		return RemoveMemberOutput{}, err
	}
	if in.Caller == in.TargetUser {
		return RemoveMemberOutput{}, domain.NewInvalid("target_user", "cannot remove yourself; transfer ownership first")
	}
	if err := uc.Vaults.RemoveMember(ctx, in.VaultID, in.TargetUser); err != nil {
		return RemoveMemberOutput{}, err
	}
	remaining, err := uc.Vaults.ListMembers(ctx, in.VaultID)
	if err != nil {
		return RemoveMemberOutput{}, fmt.Errorf("list members: %w", err)
	}
	return RemoveMemberOutput{RemainingMembers: remaining, RekeyRequired: true}, nil
}

// RekeyBlob is one of the re-wrapped vault keys submitted by the admin
// client after a member removal.
type RekeyBlob struct {
	UserID            user.ID
	EncryptedVaultKey crypto.EncryptedBlob
	WrapSignature     crypto.Signature
}

// ItemReblob is one of the re-encrypted items submitted by the admin
// client during rekey.
type ItemReblob struct {
	ItemID        domainvault.ItemID
	EncryptedData crypto.EncryptedBlob
	EncryptedName crypto.EncryptedBlob
}

// RekeyVaultInput is the full rekey submission (C2). The admin client:
//   1. Decrypts every item with the OLD vault key (client-side).
//   2. Generates a NEW vault key.
//   3. Re-encrypts every item.
//   4. Re-wraps the new vault key for every remaining member.
//   5. Submits all new blobs in one transaction.
type RekeyVaultInput struct {
	Caller  user.ID
	VaultID domainvault.ID
	NewKeys []RekeyBlob
	Items   []ItemReblob
}

// RekeyVault replaces all item ciphertexts + wrapped vault keys atomically.
type RekeyVault struct {
	Vaults ports.VaultRepository
	Items  ports.ItemRepository
}

// Execute runs the use case.
func (uc *RekeyVault) Execute(ctx context.Context, in RekeyVaultInput) error {
	callerRole, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID)
	if err != nil {
		return err
	}
	if err := ensureRoleAtLeast(callerRole, user.RoleAdmin); err != nil {
		return err
	}
	v, err := uc.Vaults.Get(ctx, in.VaultID)
	if err != nil {
		return err
	}
	// Validate every replacement blob before touching storage. A single
	// malformed blob aborts the whole rekey.
	for _, blob := range in.NewKeys {
		m := domainvault.Member{
			VaultID: in.VaultID, UserID: blob.UserID,
			EncryptedVaultKey: blob.EncryptedVaultKey,
			SenderID:          in.Caller, WrapSignature: blob.WrapSignature,
			Role: user.RoleMember, // role is upserted separately
		}
		if err := m.Validate(v.Type); err != nil {
			return fmt.Errorf("rekey blob for %s: %w", blob.UserID, err)
		}
	}
	// Apply item updates.
	now := time.Now() // infra call
	for _, it := range in.Items {
		current, err := uc.Items.Get(ctx, in.VaultID, it.ItemID)
		if err != nil {
			return fmt.Errorf("load item %s: %w", it.ItemID, err)
		}
		if !current.BelongsToVault(in.VaultID) {
			return domain.ErrNotFound
		}
		current.EncryptedData = it.EncryptedData
		current.EncryptedName = it.EncryptedName
		current.UpdatedAt = now
		if err := current.Validate(); err != nil {
			return fmt.Errorf("validate item %s: %w", it.ItemID, err)
		}
		if err := uc.Items.Update(ctx, current); err != nil {
			return fmt.Errorf("persist item %s: %w", it.ItemID, err)
		}
	}
	// Apply key rewraps.
	for _, blob := range in.NewKeys {
		m := domainvault.Member{
			VaultID: in.VaultID, UserID: blob.UserID,
			EncryptedVaultKey: blob.EncryptedVaultKey,
			SenderID:          in.Caller, WrapSignature: blob.WrapSignature,
			Role:    user.RoleMember,
			AddedAt: now,
		}
		if err := uc.Vaults.AddMember(ctx, m); err != nil {
			return fmt.Errorf("rewrap member %s: %w", blob.UserID, err)
		}
	}
	return nil
}
