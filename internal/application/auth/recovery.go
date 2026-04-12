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
)

// ===========================================================================
// VerifyRecoveryKey — returns crypto material for client-side recovery
// ===========================================================================

// VerifyRecoveryKeyInput is the POST /auth/recovery/verify request.
type VerifyRecoveryKeyInput struct {
	Email string
}

// VerifyRecoveryKeyOutput returns the encrypted key material so the client
// can attempt decryption with its recovery key. The server cannot verify
// the recovery key in a zero-knowledge system — only the client can by
// trying to decrypt the blobs.
type VerifyRecoveryKeyOutput struct {
	EncryptedPrivateKey         crypto.EncryptedBlob
	EncryptedIdentityPrivateKey crypto.EncryptedBlob
	RecoveryEncryptedPrivateKey *string // AES-GCM(recoveryKey, privKey) — nil if no kit stored
	Salt                        []byte
	KDFParams                   user.KDFParams
}

// VerifyRecoveryKey returns the user's encrypted key material for recovery.
type VerifyRecoveryKey struct {
	Users ports.UserRepository
}

// Execute runs the use case.
func (uc *VerifyRecoveryKey) Execute(ctx context.Context, in VerifyRecoveryKeyInput) (VerifyRecoveryKeyOutput, error) {
	email, err := user.NewEmail(in.Email)
	if err != nil {
		return VerifyRecoveryKeyOutput{}, ErrInvalidCredentials
	}

	u, err := uc.Users.GetRecoveryMaterial(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return VerifyRecoveryKeyOutput{}, ErrInvalidCredentials
		}
		return VerifyRecoveryKeyOutput{}, fmt.Errorf("get recovery material: %w", err)
	}

	return VerifyRecoveryKeyOutput{
		EncryptedPrivateKey:         u.EncryptedPrivateKey,
		EncryptedIdentityPrivateKey: u.EncryptedIdentityPrivateKey,
		RecoveryEncryptedPrivateKey: u.RecoveryEncryptedPrivateKey,
		Salt:                        u.Salt,
		KDFParams:                   u.KDFParams,
	}, nil
}

// ===========================================================================
// ResetViaRecovery — reset password after client-side recovery verification
// ===========================================================================

// ResetViaRecoveryInput is the POST /auth/recovery/reset request. The client
// has already verified the recovery key by decrypting the key material, and
// is now submitting re-encrypted blobs with the new stretched key.
type ResetViaRecoveryInput struct {
	Email                       string
	NewAuthHash                 []byte
	EncryptedPrivateKey         []byte // re-encrypted with new stretchedKey (wire blob bytes)
	EncryptedIdentityPrivateKey []byte // re-encrypted with new stretchedKey (wire blob bytes)
}

// ResetViaRecoveryOutput returns fresh tokens after successful password reset.
type ResetViaRecoveryOutput struct {
	UserID           user.ID
	AccessToken      string
	RefreshToken     string
	RefreshExpiresAt time.Time
}

// ResetViaRecovery replaces the auth hash and encrypted keys, revokes all
// sessions, and issues fresh tokens. This is like PasswordChange but
// without requiring the old auth hash — the client proves knowledge of the
// recovery key by submitting correctly re-encrypted key material.
type ResetViaRecovery struct {
	Users          ports.UserRepository
	Sessions       ports.SessionStore
	Hasher         ports.AuthHasher
	Tokens         ports.TokenIssuer
	TokenGenerator ports.TokenGenerator
	HMAC           ports.HMACer
	Clock          ports.Clock
	IDs            ports.IDGenerator
	RefreshTTL     time.Duration
}

// Execute runs the use case.
func (uc *ResetViaRecovery) Execute(ctx context.Context, in ResetViaRecoveryInput) (ResetViaRecoveryOutput, error) {
	// Validate input
	if len(in.NewAuthHash) == 0 {
		return ResetViaRecoveryOutput{}, domain.NewInvalid("new_auth_hash", "required")
	}
	if len(in.EncryptedPrivateKey) == 0 {
		return ResetViaRecoveryOutput{}, domain.NewInvalid("encrypted_private_key", "required")
	}
	if len(in.EncryptedIdentityPrivateKey) == 0 {
		return ResetViaRecoveryOutput{}, domain.NewInvalid("encrypted_identity_private_key", "required")
	}

	email, err := user.NewEmail(in.Email)
	if err != nil {
		return ResetViaRecoveryOutput{}, ErrInvalidCredentials
	}

	// Look up the user
	u, err := uc.Users.FindByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return ResetViaRecoveryOutput{}, ErrInvalidCredentials
		}
		return ResetViaRecoveryOutput{}, fmt.Errorf("find user: %w", err)
	}

	// Hash the new auth hash server-side
	newHashed, err := uc.Hasher.Hash(in.NewAuthHash)
	if err != nil {
		return ResetViaRecoveryOutput{}, fmt.Errorf("hash new auth hash: %w", err)
	}

	// Persist atomically: new hash + re-encrypted keys
	if err := uc.Users.UpdatePasswordMaterial(
		ctx, u.ID, newHashed,
		in.EncryptedPrivateKey, in.EncryptedIdentityPrivateKey,
	); err != nil {
		return ResetViaRecoveryOutput{}, fmt.Errorf("update password material: %w", err)
	}

	// Revoke all sessions (force re-login everywhere)
	if err := uc.Sessions.RevokeAllForUser(ctx, u.ID); err != nil {
		return ResetViaRecoveryOutput{}, fmt.Errorf("revoke sessions: %w", err)
	}

	// Issue fresh tokens
	now := uc.Clock.Now()
	access, err := uc.Tokens.Issue(u.ID.String(), u.Role.String(), now, time.Time{})
	if err != nil {
		return ResetViaRecoveryOutput{}, fmt.Errorf("issue access token: %w", err)
	}
	refresh, err := uc.TokenGenerator.RefreshToken()
	if err != nil {
		return ResetViaRecoveryOutput{}, fmt.Errorf("gen refresh token: %w", err)
	}
	refreshHash, err := user.NewRefreshTokenHash(uc.HMAC.HashString(refresh))
	if err != nil {
		return ResetViaRecoveryOutput{}, fmt.Errorf("hash refresh token: %w", err)
	}

	refreshExpiresAt := now.Add(uc.RefreshTTL)
	session := user.Session{
		ID:        user.SessionID(uc.IDs.NewID()),
		UserID:    u.ID,
		TokenHash: refreshHash,
		ExpiresAt: refreshExpiresAt,
		CreatedAt: now,
	}
	if err := session.Validate(now); err != nil {
		return ResetViaRecoveryOutput{}, fmt.Errorf("session invariants: %w", err)
	}
	if err := uc.Sessions.Create(ctx, session); err != nil {
		return ResetViaRecoveryOutput{}, fmt.Errorf("persist session: %w", err)
	}

	return ResetViaRecoveryOutput{
		UserID:           u.ID,
		AccessToken:      access,
		RefreshToken:     refresh,
		RefreshExpiresAt: refreshExpiresAt,
	}, nil
}
