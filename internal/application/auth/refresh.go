package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// RefreshInput is the POST /auth/refresh request.
type RefreshInput struct {
	RefreshToken string
}

// RefreshOutput carries the rotated tokens. The old refresh token is
// invalidated atomically — a successful refresh returns a NEW refresh
// token; any subsequent use of the old one is treated as compromise and
// the session is revoked.
type RefreshOutput struct {
	AccessToken      string
	RefreshToken     string
	RefreshExpiresAt time.Time
}

// Refresh rotates an access+refresh pair.
type Refresh struct {
	Users          ports.UserRepository
	Sessions       ports.SessionStore
	Tokens         ports.TokenIssuer
	TokenGenerator ports.TokenGenerator
	HMAC           ports.HMACer
	Clock          ports.Clock
	RefreshTTL     time.Duration
}

// Execute verifies the presented refresh token's hash, rotates it, and
// issues a new access token.
func (uc *Refresh) Execute(ctx context.Context, in RefreshInput) (RefreshOutput, error) {
	hashBytes := uc.HMAC.HashString(in.RefreshToken)
	hash, err := user.NewRefreshTokenHash(hashBytes)
	if err != nil {
		return RefreshOutput{}, fmt.Errorf("hash refresh token: %w", err)
	}

	session, err := uc.Sessions.FindByTokenHash(ctx, hash)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return RefreshOutput{}, ErrInvalidCredentials
		}
		return RefreshOutput{}, fmt.Errorf("load session: %w", err)
	}

	now := uc.Clock.Now()
	if session.IsExpired(now) {
		// Clean up expired row; don't leak identity.
		_ = uc.Sessions.Revoke(ctx, session.ID)
		return RefreshOutput{}, ErrSessionExpired
	}

	u, err := uc.Users.FindByID(ctx, session.UserID)
	if err != nil {
		return RefreshOutput{}, fmt.Errorf("load user: %w", err)
	}

	// Rotate refresh token.
	newRefresh, err := uc.TokenGenerator.RefreshToken()
	if err != nil {
		return RefreshOutput{}, fmt.Errorf("gen refresh token: %w", err)
	}
	newHash, err := user.NewRefreshTokenHash(uc.HMAC.HashString(newRefresh))
	if err != nil {
		return RefreshOutput{}, fmt.Errorf("hash new refresh: %w", err)
	}
	newExpiresAt := now.Add(uc.RefreshTTL)
	if err := uc.Sessions.Rotate(ctx, session.ID, newHash, now, newExpiresAt); err != nil {
		return RefreshOutput{}, fmt.Errorf("rotate refresh: %w", err)
	}

	// Issue new access token.
	access, err := uc.Tokens.Issue(u.ID.String(), u.Role.String(), now, time.Time{})
	if err != nil {
		return RefreshOutput{}, fmt.Errorf("issue access token: %w", err)
	}

	return RefreshOutput{
		AccessToken:      access,
		RefreshToken:     newRefresh,
		RefreshExpiresAt: newExpiresAt,
	}, nil
}
