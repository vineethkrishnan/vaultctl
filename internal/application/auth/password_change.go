// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// PasswordChangeInput carries the old + new credentials. Re-encrypted private
// keys are provided by the client (which re-derives stretchedKey locally).
type PasswordChangeInput struct {
	Caller                      user.ID
	Role                        user.Role
	OldAuthHash                 []byte
	NewAuthHash                 []byte
	EncryptedPrivateKey         []byte // re-encrypted with new stretchedKey (wire blob bytes)
	EncryptedIdentityPrivateKey []byte // re-encrypted with new stretchedKey (wire blob bytes)
}

// PasswordChangeOutput returns fresh tokens (old ones are revoked).
type PasswordChangeOutput struct {
	AccessToken      string
	RefreshToken     string
	RefreshExpiresAt time.Time
}

// PasswordChange verifies the old password, persists new auth hash +
// re-encrypted keys, revokes all sessions, and issues fresh tokens.
type PasswordChange struct {
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

func (uc *PasswordChange) Execute(ctx context.Context, in PasswordChangeInput) (PasswordChangeOutput, error) {
	// Verify old password
	stored, err := uc.Users.AuthHash(ctx, in.Caller)
	if err != nil {
		return PasswordChangeOutput{}, fmt.Errorf("load auth hash: %w", err)
	}
	ok, _, err := uc.Hasher.Verify(in.OldAuthHash, stored)
	if err != nil {
		return PasswordChangeOutput{}, fmt.Errorf("verify old hash: %w", err)
	}
	if !ok {
		return PasswordChangeOutput{}, ErrInvalidCredentials
	}

	// Hash the new authHash server-side
	newHashed, err := uc.Hasher.Hash(in.NewAuthHash)
	if err != nil {
		return PasswordChangeOutput{}, fmt.Errorf("hash new authHash: %w", err)
	}

	// Persist atomically: new hash + re-encrypted keys
	if err := uc.Users.UpdatePasswordMaterial(
		ctx, in.Caller, newHashed,
		in.EncryptedPrivateKey, in.EncryptedIdentityPrivateKey,
	); err != nil {
		return PasswordChangeOutput{}, fmt.Errorf("update password material: %w", err)
	}

	// Revoke all sessions (force re-login everywhere)
	if err := uc.Sessions.RevokeAllForUser(ctx, in.Caller); err != nil {
		return PasswordChangeOutput{}, fmt.Errorf("revoke sessions: %w", err)
	}

	// Issue fresh tokens
	now := uc.Clock.Now()
	access, err := uc.Tokens.Issue(in.Caller.String(), in.Role.String(), now, time.Time{})
	if err != nil {
		return PasswordChangeOutput{}, fmt.Errorf("issue access token: %w", err)
	}
	refresh, err := uc.TokenGenerator.RefreshToken()
	if err != nil {
		return PasswordChangeOutput{}, fmt.Errorf("gen refresh token: %w", err)
	}
	refreshHash, err := user.NewRefreshTokenHash(uc.HMAC.HashString(refresh))
	if err != nil {
		return PasswordChangeOutput{}, fmt.Errorf("hash refresh token: %w", err)
	}

	refreshExpiresAt := now.Add(uc.RefreshTTL)
	session := user.Session{
		ID:        user.SessionID(uc.IDs.NewID()),
		UserID:    in.Caller,
		TokenHash: refreshHash,
		ExpiresAt: refreshExpiresAt,
		CreatedAt: now,
	}
	if err := session.Validate(now); err != nil {
		return PasswordChangeOutput{}, fmt.Errorf("session invariants: %w", err)
	}
	if err := uc.Sessions.Create(ctx, session); err != nil {
		return PasswordChangeOutput{}, fmt.Errorf("persist session: %w", err)
	}

	return PasswordChangeOutput{
		AccessToken:      access,
		RefreshToken:     refresh,
		RefreshExpiresAt: refreshExpiresAt,
	}, nil
}
