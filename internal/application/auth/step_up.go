// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// StepUpInput carries the master password re-verification proof.
type StepUpInput struct {
	Caller   user.ID
	Role     user.Role
	AuthHash []byte // re-derived client-side authHash
}

// StepUpOutput returns a fresh access token with the step-up claim set.
type StepUpOutput struct {
	AccessToken string
}

// StepUp re-verifies the caller's master password and issues a fresh JWT
// with a step-up claim valid for StepUpTTL (H10: ≤5 min).
type StepUp struct {
	Users     ports.UserRepository
	Hasher    ports.AuthHasher
	Tokens    ports.TokenIssuer
	Clock     ports.Clock
	StepUpTTL time.Duration
}

// Execute verifies the authHash and reissues the access token.
func (uc *StepUp) Execute(ctx context.Context, in StepUpInput) (StepUpOutput, error) {
	stored, err := uc.Users.AuthHash(ctx, in.Caller)
	if err != nil {
		return StepUpOutput{}, fmt.Errorf("load auth hash: %w", err)
	}

	ok, _, err := uc.Hasher.Verify(in.AuthHash, stored)
	if err != nil {
		return StepUpOutput{}, fmt.Errorf("verify auth hash: %w", err)
	}
	if !ok {
		return StepUpOutput{}, ErrInvalidCredentials
	}

	now := uc.Clock.Now()
	stepUpUntil := now.Add(uc.StepUpTTL)

	token, err := uc.Tokens.Issue(in.Caller.String(), in.Role.String(), now, stepUpUntil)
	if err != nil {
		return StepUpOutput{}, fmt.Errorf("issue step-up token: %w", err)
	}

	return StepUpOutput{AccessToken: token}, nil
}
