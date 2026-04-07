package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// LogoutInput is the POST /auth/logout request.
type LogoutInput struct {
	RefreshToken string
}

// Logout revokes the session behind a refresh token. Idempotent: repeated
// logouts with the same token are no-ops.
type Logout struct {
	Sessions ports.SessionStore
	HMAC     ports.HMACer
}

// Execute revokes the session, if any, matching the refresh token's hash.
func (uc *Logout) Execute(ctx context.Context, in LogoutInput) error {
	hash, err := user.NewRefreshTokenHash(uc.HMAC.HashString(in.RefreshToken))
	if err != nil {
		return nil // nothing to revoke; idempotent
	}
	session, err := uc.Sessions.FindByTokenHash(ctx, hash)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil
		}
		return fmt.Errorf("load session: %w", err)
	}
	if err := uc.Sessions.Revoke(ctx, session.ID); err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	return nil
}
