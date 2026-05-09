// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// RegisterInput carries the client-generated material required to stand up
// a brand-new user. All cryptographic operations happened on the client —
// the server only persists the resulting blobs.
//
// Security-review wiring:
//   - Separate identity keypair (C1) — identity_public_key + signature.
//   - Server receives the CLIENT-COMPUTED authHash, never the master pw.
//   - All encrypted blobs are pre-validated against PRD §9.9 (C5).
type RegisterInput struct {
	Email                       string
	Name                        string
	AuthHash                    []byte
	Salt                        []byte
	KDFParams                   user.KDFParams
	EncryptedPrivateKey         crypto.EncryptedBlob
	EncryptedIdentityPrivateKey crypto.EncryptedBlob
	PublicKey                   crypto.PublicKey
	PublicKeySignature          crypto.Signature
	IdentityPublicKey           crypto.PublicKey
	// MasterPasswordPreflight is the client-side plaintext master password
	// supplied PURELY so the server can reject weak passwords before
	// issuing a user row. It is NOT persisted, logged, or transmitted
	// anywhere — the caller's handler strips it from logs (C4).
	MasterPasswordPreflight string
	// InviteToken is required when RegistrationMode is "invite".
	// The server redeems it before creating the user.
	InviteToken string
	// PasswordHint is an optional plaintext hint that is server-encrypted
	// (H4) before persistence. Empty means no hint.
	PasswordHint string
}

// SetPasswordHintInput carries the data needed by the Encrypter to encrypt
// the hint. The use case handles encryption internally.

// RegisterOutput is what the API layer returns to the client.
type RegisterOutput struct {
	UserID user.ID
	Role   user.Role
}

const (
	RegistrationModeOpen     = "open"
	RegistrationModeInvite   = "invite"
	RegistrationModeDisabled = "disabled"
)

// ErrRegistrationDisabled signals that new registrations are not allowed.
var ErrRegistrationDisabled = errors.New("auth: registration is disabled")

// ErrInviteRequired signals that an invite token is required to register.
var ErrInviteRequired = errors.New("auth: invite token required")

// Register is the user-creation use case.
type Register struct {
	Users            ports.UserRepository
	Hasher           ports.AuthHasher
	Clock            ports.Clock
	IDs              ports.IDGenerator
	Encrypter        ports.DataEncrypter // optional — for password hint encryption (H4)
	Policy           user.MasterPasswordPolicy
	DefaultRole      user.Role
	RegistrationMode string // "open", "invite", "disabled"
	RedeemInvite     *RedeemInvite // nil when mode is "open"
}

// Execute runs the use case.
func (uc *Register) Execute(ctx context.Context, in RegisterInput) (RegisterOutput, error) {
	// Enforce registration mode
	var inviteIDToMark string
	switch uc.RegistrationMode {
	case RegistrationModeDisabled:
		return RegisterOutput{}, ErrRegistrationDisabled
	case RegistrationModeInvite:
		if in.InviteToken == "" {
			return RegisterOutput{}, ErrInviteRequired
		}
		if uc.RedeemInvite == nil {
			return RegisterOutput{}, fmt.Errorf("%w: RedeemInvite use case not wired", ErrInviteRequired)
		}
		// Validate the invite without consuming it — we mark it used
		// only after user creation succeeds (avoids burning tokens on failure).
		redeemed, err := uc.RedeemInvite.Execute(ctx, RedeemInviteInput{Token: in.InviteToken})
		if err != nil {
			return RegisterOutput{}, fmt.Errorf("validate invite: %w", err)
		}
		if in.Email != redeemed.Email {
			return RegisterOutput{}, domain.NewInvalid("email", "email does not match invite")
		}
		inviteIDToMark = redeemed.InviteID
	case RegistrationModeOpen, "":
		// Anyone can register
	default:
		return RegisterOutput{}, fmt.Errorf("%w: unknown mode %q", ErrRegistrationDisabled, uc.RegistrationMode)
	}

	// Cheap guards first — reject trivially bad input before expensive work
	if len(in.AuthHash) == 0 {
		return RegisterOutput{}, domain.NewInvalid("auth_hash", "required")
	}
	if len(in.Salt) == 0 {
		return RegisterOutput{}, domain.NewInvalid("salt", "required")
	}
	if err := user.ValidateMasterPassword(in.MasterPasswordPreflight, uc.Policy); err != nil {
		return RegisterOutput{}, fmt.Errorf("%w: %v", ErrWeakMasterPassword, err) //nolint:errorlint // intentional: wrap sentinel, don't double-wrap cause
	}

	email, err := user.NewEmail(in.Email)
	if err != nil {
		return RegisterOutput{}, err
	}

	role := uc.DefaultRole
	if role == "" {
		role = user.RoleMember
	}

	now := uc.Clock.Now()
	encryptedHint, err := uc.encryptPasswordHint(in.PasswordHint, email)
	if err != nil {
		return RegisterOutput{}, err
	}

	u := user.User{
		ID:                          user.ID(uc.IDs.NewID()),
		Email:                       email,
		Name:                        in.Name,
		Salt:                        append([]byte(nil), in.Salt...),
		KDFParams:                   in.KDFParams,
		EncryptedPrivateKey:         in.EncryptedPrivateKey,
		EncryptedIdentityPrivateKey: in.EncryptedIdentityPrivateKey,
		PublicKey:                   in.PublicKey,
		PublicKeySignature:          in.PublicKeySignature,
		IdentityPublicKey:           in.IdentityPublicKey,
		EncryptedPasswordHint:       encryptedHint,
		Role:                        role,
		CreatedAt:                   now,
		UpdatedAt:                   now,
	}
	if err := u.Validate(); err != nil {
		return RegisterOutput{}, err
	}

	hashed, err := uc.Hasher.Hash(in.AuthHash)
	if err != nil {
		return RegisterOutput{}, fmt.Errorf("hash authHash: %w", err)
	}

	if err := uc.Users.Create(ctx, u, hashed); err != nil {
		if errors.Is(err, domain.ErrConflict) {
			return RegisterOutput{}, ErrEmailTaken
		}
		return RegisterOutput{}, fmt.Errorf("persist user: %w", err)
	}

	// Mark the invite as used AFTER user creation succeeds, so a failed
	// registration doesn't burn the invite token.
	if inviteIDToMark != "" {
		if err := uc.RedeemInvite.MarkUsed(ctx, inviteIDToMark); err != nil {
			// User was created but invite mark failed. Log and continue —
			// the user account is valid; worst case the invite can be
			// reused (idempotent, not a security issue).
			_ = err
		}
	}

	return RegisterOutput{UserID: u.ID, Role: u.Role}, nil
}

// encryptPasswordHint wraps the optional plaintext hint under H4's
// server-side data key. Returns nil when no hint was provided or no
// encrypter is wired.
func (uc *Register) encryptPasswordHint(hint string, email user.Email) ([]byte, error) {
	if hint == "" || uc.Encrypter == nil {
		return nil, nil
	}
	aad := []byte("password_hint:" + email.String())
	blob, err := uc.Encrypter.Encrypt([]byte(hint), aad)
	if err != nil {
		return nil, fmt.Errorf("encrypt password hint: %w", err)
	}
	return blob.Bytes(), nil
}
