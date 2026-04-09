package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// InviteRepo is the pgx-backed ports.InviteRepository.
type InviteRepo struct{ Pool *Pool }

// Create inserts a new invite row.
func (r *InviteRepo) Create(ctx context.Context, inv organization.Invite) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO org_invites (id, org_id, invited_by, email, token_hash, role, expires_at, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
	`,
		string(inv.ID), string(inv.OrgID), string(inv.InvitedBy), inv.Email.String(),
		inv.TokenHash.Bytes(), string(inv.Role), inv.ExpiresAt, inv.CreatedAt)
	return err
}

// GetByTokenHash loads an invite by its HMAC'd token hash.
func (r *InviteRepo) GetByTokenHash(ctx context.Context, tokenHash []byte) (organization.Invite, error) {
	return r.query(ctx, "token_hash = $1", tokenHash)
}

// GetByID loads an invite by its primary key.
func (r *InviteRepo) GetByID(ctx context.Context, id string) (organization.Invite, error) {
	return r.query(ctx, "id = $1", id)
}

// ListByOrg returns pending invites for an organization (not used, not revoked,
// not expired).
func (r *InviteRepo) ListByOrg(ctx context.Context, orgID string) ([]organization.Invite, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT id, org_id, invited_by, email, token_hash, role,
		       expires_at, used_at, revoked_at, created_at
		FROM org_invites
		WHERE org_id = $1 AND used_at IS NULL AND revoked_at IS NULL
		ORDER BY created_at DESC
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []organization.Invite{}
	for rows.Next() {
		inv, err := scanInvite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

// MarkUsed sets used_at on an invite row.
func (r *InviteRepo) MarkUsed(ctx context.Context, id string, usedAt time.Time) error {
	tag, err := r.Pool.Exec(ctx,
		`UPDATE org_invites SET used_at = $1 WHERE id = $2`, usedAt, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// MarkRevoked sets revoked_at on an invite row.
func (r *InviteRepo) MarkRevoked(ctx context.Context, id string, revokedAt time.Time) error {
	tag, err := r.Pool.Exec(ctx,
		`UPDATE org_invites SET revoked_at = $1 WHERE id = $2`, revokedAt, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ===========================================================================
// internal
// ===========================================================================

func (r *InviteRepo) query(ctx context.Context, where string, arg any) (organization.Invite, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, org_id, invited_by, email, token_hash, role,
		       expires_at, used_at, revoked_at, created_at
		FROM org_invites WHERE `+where, arg)
	return scanInvite(row)
}

type inviteScanner interface {
	Scan(...any) error
}

func scanInvite(row inviteScanner) (organization.Invite, error) {
	var (
		id, orgID, invitedBy string
		email, role          string
		tokenHash            []byte
		expiresAt, createdAt time.Time
		usedAt, revokedAt    *time.Time
	)
	err := row.Scan(&id, &orgID, &invitedBy, &email, &tokenHash, &role,
		&expiresAt, &usedAt, &revokedAt, &createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return organization.Invite{}, domain.ErrNotFound
	}
	if err != nil {
		return organization.Invite{}, fmt.Errorf("scan invite: %w", err)
	}

	em, err := user.NewEmail(email)
	if err != nil {
		return organization.Invite{}, fmt.Errorf("decode invite email: %w", err)
	}
	th, err := organization.NewInviteTokenHash(tokenHash)
	if err != nil {
		return organization.Invite{}, fmt.Errorf("decode invite token_hash: %w", err)
	}

	return organization.Invite{
		ID:        organization.InviteID(id),
		OrgID:     organization.ID(orgID),
		InvitedBy: user.ID(invitedBy),
		Email:     em,
		TokenHash: th,
		Role:      user.Role(role),
		ExpiresAt: expiresAt,
		UsedAt:    usedAt,
		RevokedAt: revokedAt,
		CreatedAt: createdAt,
	}, nil
}
