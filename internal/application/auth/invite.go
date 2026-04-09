package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// ===========================================================================
// Invite errors
// ===========================================================================

// ErrInviteNotRedeemable signals the token is expired, already used, or revoked.
var ErrInviteNotRedeemable = fmt.Errorf("%w: invite not redeemable", domain.ErrInvalid)

// ===========================================================================
// CreateInvite
// ===========================================================================

// CreateInviteInput carries what an admin needs to issue an invite.
type CreateInviteInput struct {
	Caller    user.ID
	OrgID     organization.ID
	Email     string
	Role      user.Role
	ExpiresIn time.Duration
}

// CreateInviteOutput is returned to the API layer; the raw token is shown to
// the admin exactly once.
type CreateInviteOutput struct {
	InviteID string
	Token    string
}

// CreateInvite generates a new org invite.
type CreateInvite struct {
	Invites ports.InviteRepository
	HMAC    ports.HMACer
	Tokens  ports.TokenGenerator
	Clock   ports.Clock
	IDs     ports.IDGenerator
}

// Execute creates the invite.
func (uc *CreateInvite) Execute(ctx context.Context, in CreateInviteInput) (CreateInviteOutput, error) {
	email, err := user.NewEmail(in.Email)
	if err != nil {
		return CreateInviteOutput{}, err
	}
	if !in.Role.IsValid() {
		return CreateInviteOutput{}, domain.NewInvalid("role", "invalid")
	}

	// Generate random token and HMAC it for storage
	rawToken, err := uc.Tokens.InviteToken()
	if err != nil {
		return CreateInviteOutput{}, fmt.Errorf("generate invite token: %w", err)
	}
	hashBytes := uc.HMAC.HashString(rawToken)
	tokenHash, err := organization.NewInviteTokenHash(hashBytes)
	if err != nil {
		return CreateInviteOutput{}, fmt.Errorf("wrap invite token hash: %w", err)
	}

	now := uc.Clock.Now()
	inv := organization.Invite{
		ID:        organization.InviteID(uc.IDs.NewID()),
		OrgID:     in.OrgID,
		InvitedBy: in.Caller,
		Email:     email,
		TokenHash: tokenHash,
		Role:      in.Role,
		ExpiresAt: now.Add(in.ExpiresIn),
		CreatedAt: now,
	}
	if err := inv.Validate(now); err != nil {
		return CreateInviteOutput{}, err
	}

	if err := uc.Invites.Create(ctx, inv); err != nil {
		return CreateInviteOutput{}, fmt.Errorf("persist invite: %w", err)
	}

	return CreateInviteOutput{
		InviteID: string(inv.ID),
		Token:    rawToken,
	}, nil
}

// ===========================================================================
// RedeemInvite
// ===========================================================================

// RedeemInviteInput carries the raw token from the invite link.
type RedeemInviteInput struct {
	Token string
}

// RedeemInviteOutput returns the email + role so the registration flow can
// pre-fill and enforce them.
type RedeemInviteOutput struct {
	OrgID string
	Email string
	Role  user.Role
}

// RedeemInvite validates and marks an invite as used.
type RedeemInvite struct {
	Invites ports.InviteRepository
	HMAC    ports.HMACer
	Clock   ports.Clock
}

// Execute redeems the invite.
func (uc *RedeemInvite) Execute(ctx context.Context, in RedeemInviteInput) (RedeemInviteOutput, error) {
	if in.Token == "" {
		return RedeemInviteOutput{}, domain.NewInvalid("token", "required")
	}

	hashBytes := uc.HMAC.HashString(in.Token)
	inv, err := uc.Invites.GetByTokenHash(ctx, hashBytes)
	if err != nil {
		return RedeemInviteOutput{}, err
	}

	now := uc.Clock.Now()
	if !inv.IsRedeemable(now) {
		return RedeemInviteOutput{}, ErrInviteNotRedeemable
	}

	if err := uc.Invites.MarkUsed(ctx, string(inv.ID), now); err != nil {
		return RedeemInviteOutput{}, fmt.Errorf("mark invite used: %w", err)
	}

	return RedeemInviteOutput{
		OrgID: string(inv.OrgID),
		Email: inv.Email.String(),
		Role:  inv.Role,
	}, nil
}

// ===========================================================================
// RevokeInvite
// ===========================================================================

// RevokeInviteInput identifies the invite to revoke.
type RevokeInviteInput struct {
	Caller   user.ID
	InviteID string
}

// RevokeInvite cancels a pending invite.
type RevokeInvite struct {
	Invites ports.InviteRepository
	Clock   ports.Clock
}

// Execute revokes the invite.
func (uc *RevokeInvite) Execute(ctx context.Context, in RevokeInviteInput) error {
	if in.InviteID == "" {
		return domain.NewInvalid("invite_id", "required")
	}

	inv, err := uc.Invites.GetByID(ctx, in.InviteID)
	if err != nil {
		return err
	}

	now := uc.Clock.Now()
	revoked := inv.Revoke(now)
	if revoked.RevokedAt == nil {
		// Already revoked — idempotent success
		return nil
	}

	return uc.Invites.MarkRevoked(ctx, in.InviteID, *revoked.RevokedAt)
}

// ===========================================================================
// ListInvites
// ===========================================================================

// ListInvitesInput identifies the org whose invites to list.
type ListInvitesInput struct {
	Caller user.ID
	OrgID  organization.ID
}

// ListInvites returns pending invites for an org.
type ListInvites struct {
	Invites ports.InviteRepository
}

// Execute lists pending invites.
func (uc *ListInvites) Execute(ctx context.Context, in ListInvitesInput) ([]organization.Invite, error) {
	return uc.Invites.ListByOrg(ctx, string(in.OrgID))
}
