// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// LoginInput is the POST /auth/login request.
//
// NOTE: AuthHash is the long-term authentication credential (architecture
// §13.1/C4). Handlers MUST strip it from logs via the redaction middleware.
type LoginInput struct {
	Email      string
	AuthHash   []byte
	DeviceName string
	IPAddress  string // already anonymised per VAULTCTL_LOG_IP_PRECISION (M1)
}

// VaultMembership is the per-vault key material the client needs to decrypt
// vault items (architecture §4.2).
type VaultMembership struct {
	VaultID           vault.ID
	VaultName         string
	VaultType         vault.Type
	EncryptedVaultKey crypto.EncryptedBlob
	SenderID          user.ID
	WrapSignature     crypto.Signature
	Role              user.Role
}

// LoginOutput is returned on success. encrypted_private_key + vault key
// material travels back so the client can hydrate its Web Worker scope (M9).
type LoginOutput struct {
	UserID              user.ID
	Role                user.Role
	AccessToken         string
	RefreshToken        string
	SessionID           user.SessionID
	AccessExpiresAt     time.Time
	RefreshExpiresAt    time.Time
	UpgradeAuthHash     bool // tells caller to re-hash + persist (Argon2 param bump)

	// User crypto material for client-side key hydration
	EncryptedPrivateKey         crypto.EncryptedBlob
	EncryptedIdentityPrivateKey crypto.EncryptedBlob
	PublicKey                   crypto.PublicKey
	PublicKeySignature          crypto.Signature
	IdentityPublicKey           crypto.PublicKey

	// Vault memberships with wrapped keys
	Vaults []VaultMembership
}

// Login is the authentication use case.
type Login struct {
	Users           ports.UserRepository
	Sessions        ports.SessionStore
	Vaults          ports.VaultRepository
	Hasher          ports.AuthHasher
	Tokens          ports.TokenIssuer
	TokenGenerator  ports.TokenGenerator
	HMAC            ports.HMACer
	Clock           ports.Clock
	IDs             ports.IDGenerator
	MaxAttempts     int
	LockoutDuration time.Duration
	RefreshTTL      time.Duration
}

// Execute performs the login flow. All failure modes collapse to
// ErrInvalidCredentials or ErrAccountLocked so an attacker can't probe
// whether a given email exists (H2 + H3 intent).
func (uc *Login) Execute(ctx context.Context, in LoginInput) (LoginOutput, error) {
	email, err := user.NewEmail(in.Email)
	if err != nil {
		return LoginOutput{}, ErrInvalidCredentials
	}

	u, err := uc.Users.FindByEmail(ctx, email)
	if err != nil {
		// Unknown email: still perform a throwaway Argon2 verify on the
		// stored all-zeros hash so timing matches the real-user path.
		// Full constant-time decoy landing in M3 follow-up.
		_, _, _ = uc.Hasher.Verify(in.AuthHash, "$argon2id$v=19$m=8192,t=1,p=1$YWFhYWFhYWE$YWFhYWFhYWFhYWFhYWFh")
		return LoginOutput{}, ErrInvalidCredentials
	}

	now := uc.Clock.Now()
	if u.IsLocked(now) {
		return LoginOutput{}, ErrAccountLocked
	}

	stored, err := uc.Users.AuthHash(ctx, u.ID)
	if err != nil {
		return LoginOutput{}, fmt.Errorf("load auth hash: %w", err)
	}

	ok, upgrade, err := uc.Hasher.Verify(in.AuthHash, stored)
	if err != nil {
		return LoginOutput{}, fmt.Errorf("verify auth hash: %w", err)
	}
	if !ok {
		attempts := u.FailedLoginAttempts + 1
		var locked *time.Time
		if attempts >= uc.MaxAttempts {
			until := now.Add(uc.LockoutDuration)
			locked = &until
		}
		if err := uc.Users.ApplyFailedLogin(ctx, u.ID, attempts, locked); err != nil {
			return LoginOutput{}, fmt.Errorf("record failed login: %w", err)
		}
		if locked != nil {
			return LoginOutput{}, ErrAccountLocked
		}
		return LoginOutput{}, ErrInvalidCredentials
	}

	if err := uc.Users.ResetLoginFailures(ctx, u.ID); err != nil {
		return LoginOutput{}, fmt.Errorf("reset login failures: %w", err)
	}

	// Issue access + refresh tokens.
	access, err := uc.Tokens.Issue(u.ID.String(), u.Role.String(), now, time.Time{})
	if err != nil {
		return LoginOutput{}, fmt.Errorf("issue access token: %w", err)
	}
	refresh, err := uc.TokenGenerator.RefreshToken()
	if err != nil {
		return LoginOutput{}, fmt.Errorf("gen refresh token: %w", err)
	}
	refreshHash, err := user.NewRefreshTokenHash(uc.HMAC.HashString(refresh))
	if err != nil {
		return LoginOutput{}, fmt.Errorf("hash refresh token: %w", err)
	}

	refreshExpiresAt := now.Add(uc.RefreshTTL)
	session := user.Session{
		ID:         user.SessionID(uc.IDs.NewID()),
		UserID:     u.ID,
		TokenHash:  refreshHash,
		DeviceName: in.DeviceName,
		IPAddress:  in.IPAddress,
		ExpiresAt:  refreshExpiresAt,
		CreatedAt:  now,
	}
	if err := session.Validate(now); err != nil {
		return LoginOutput{}, fmt.Errorf("session invariants: %w", err)
	}
	if err := uc.Sessions.Create(ctx, session); err != nil {
		return LoginOutput{}, fmt.Errorf("persist session: %w", err)
	}

	// Load vault memberships so the client can hydrate its key custody.
	vaults, err := uc.Vaults.ListForUser(ctx, u.ID)
	if err != nil {
		return LoginOutput{}, fmt.Errorf("list vaults: %w", err)
	}
	memberships := make([]VaultMembership, 0, len(vaults))
	for _, v := range vaults {
		m, err := uc.Vaults.MemberForUser(ctx, v.ID, u.ID)
		if err != nil {
			return LoginOutput{}, fmt.Errorf("load membership for vault %s: %w", v.ID, err)
		}
		memberships = append(memberships, VaultMembership{
			VaultID:           v.ID,
			VaultName:         v.Name,
			VaultType:         v.Type,
			EncryptedVaultKey: m.EncryptedVaultKey,
			SenderID:          m.SenderID,
			WrapSignature:     m.WrapSignature,
			Role:              m.Role,
		})
	}

	return LoginOutput{
		UserID:           u.ID,
		Role:             u.Role,
		AccessToken:      access,
		RefreshToken:     refresh,
		SessionID:        session.ID,
		RefreshExpiresAt: refreshExpiresAt,
		UpgradeAuthHash:  upgrade,

		EncryptedPrivateKey:         u.EncryptedPrivateKey,
		EncryptedIdentityPrivateKey: u.EncryptedIdentityPrivateKey,
		PublicKey:                   u.PublicKey,
		PublicKeySignature:          u.PublicKeySignature,
		IdentityPublicKey:           u.IdentityPublicKey,
		Vaults:                      memberships,
	}, nil
}

// ErrLoginInternal is a helper the handler layer uses to collapse non-auth
// infrastructure errors into a single internal-error path.
var ErrLoginInternal = errors.New("auth: internal error")

// Sentinel alias for callers that only care about "login failed".
var _ = domain.ErrNotFound
