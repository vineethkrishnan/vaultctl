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
}

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
	Policy           user.MasterPasswordPolicy
	DefaultRole      user.Role
	RegistrationMode string // "open", "invite", "disabled"
	RedeemInvite     *RedeemInvite // nil when mode is "open"
}

// Execute runs the use case.
func (uc *Register) Execute(ctx context.Context, in RegisterInput) (RegisterOutput, error) {
	// Enforce registration mode
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
		redeemed, err := uc.RedeemInvite.Execute(ctx, RedeemInviteInput{Token: in.InviteToken})
		if err != nil {
			return RegisterOutput{}, fmt.Errorf("redeem invite: %w", err)
		}
		if in.Email != redeemed.Email {
			return RegisterOutput{}, domain.NewInvalid("email", "email does not match invite")
		}
	case RegistrationModeOpen, "":
		// Anyone can register
	default:
		return RegisterOutput{}, fmt.Errorf("%w: unknown mode %q", ErrRegistrationDisabled, uc.RegistrationMode)
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
		Role:                        role,
		CreatedAt:                   now,
		UpdatedAt:                   now,
	}
	if err := u.Validate(); err != nil {
		return RegisterOutput{}, err
	}
	// Refuse to call the hasher with a trivially wrong authHash.
	if len(in.AuthHash) == 0 {
		return RegisterOutput{}, domain.NewInvalid("auth_hash", "required")
	}
	if len(in.Salt) == 0 {
		return RegisterOutput{}, domain.NewInvalid("salt", "required")
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

	return RegisterOutput{UserID: u.ID, Role: u.Role}, nil
}
