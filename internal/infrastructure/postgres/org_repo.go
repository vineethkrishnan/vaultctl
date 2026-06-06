// SPDX-License-Identifier: AGPL-3.0-or-later

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

// OrgRepo is the pgx-backed ports.OrganizationRepository.
type OrgRepo struct{ Pool *Pool }

// Create inserts an organization row and the creator's initial membership
// in a single transaction.
func (r *OrgRepo) Create(ctx context.Context, org organization.Organization, creator organization.Membership) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	_, err = tx.Exec(ctx, `
		INSERT INTO organizations (id, name, created_by, created_at)
		VALUES ($1, $2, $3, $4)
	`, string(org.ID), org.Name, string(org.CreatedBy), org.CreatedAt)
	if err != nil {
		return fmt.Errorf("insert organization: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO org_members (org_id, user_id, role, invited_at, accepted_at)
		VALUES ($1, $2, $3, $4, $5)
	`, string(creator.OrgID), string(creator.UserID), string(creator.Role),
		creator.InvitedAt, creator.AcceptedAt)
	if err != nil {
		return fmt.Errorf("insert creator membership: %w", err)
	}

	return tx.Commit(ctx)
}

// GetByID loads an organization by ID.
func (r *OrgRepo) GetByID(ctx context.Context, id organization.ID) (organization.Organization, error) {
	var (
		orgID, name, createdBy string
		createdAt              time.Time
	)
	err := r.Pool.QueryRow(ctx, `
		SELECT id, name, created_by, created_at
		FROM organizations WHERE id = $1
	`, string(id)).Scan(&orgID, &name, &createdBy, &createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return organization.Organization{}, domain.ErrNotFound
	}
	if err != nil {
		return organization.Organization{}, fmt.Errorf("scan organization: %w", err)
	}
	return organization.Organization{
		ID:        organization.ID(orgID),
		Name:      name,
		CreatedBy: user.ID(createdBy),
		CreatedAt: createdAt,
	}, nil
}

// ListMembers returns all members of an organization.
func (r *OrgRepo) ListMembers(ctx context.Context, orgID organization.ID) ([]organization.Membership, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT org_id, user_id, role, invited_at, accepted_at
		FROM org_members
		WHERE org_id = $1
		ORDER BY invited_at ASC
	`, string(orgID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []organization.Membership{}
	for rows.Next() {
		m, err := scanMembership(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListForUser returns the orgs the user has actively joined (accepted invite),
// each with their role (FEAT-8).
func (r *OrgRepo) ListForUser(ctx context.Context, userID user.ID) ([]organization.UserOrg, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT o.id, o.name, m.role, m.accepted_at
		FROM org_members m
		JOIN organizations o ON o.id = m.org_id
		WHERE m.user_id = $1 AND m.accepted_at IS NOT NULL
		ORDER BY m.accepted_at ASC
	`, string(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []organization.UserOrg{}
	for rows.Next() {
		var (
			orgID, name, role string
			joinedAt          time.Time
		)
		if err := rows.Scan(&orgID, &name, &role, &joinedAt); err != nil {
			return nil, fmt.Errorf("scan user org: %w", err)
		}
		out = append(out, organization.UserOrg{
			ID:       organization.ID(orgID),
			Name:     name,
			Role:     user.Role(role),
			JoinedAt: joinedAt,
		})
	}
	return out, rows.Err()
}

// UpdateMemberRole changes a member's org-level role.
func (r *OrgRepo) UpdateMemberRole(ctx context.Context, orgID organization.ID, userID user.ID, role user.Role) error {
	tag, err := r.Pool.Exec(ctx, `
		UPDATE org_members SET role = $1
		WHERE org_id = $2 AND user_id = $3
	`, string(role), string(orgID), string(userID))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// GetMembership loads a single membership row.
func (r *OrgRepo) GetMembership(ctx context.Context, orgID organization.ID, userID user.ID) (organization.Membership, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT org_id, user_id, role, invited_at, accepted_at
		FROM org_members
		WHERE org_id = $1 AND user_id = $2
	`, string(orgID), string(userID))
	return scanMembership(row)
}

// RemoveMember hard-deletes an org membership row (C2).
func (r *OrgRepo) RemoveMember(ctx context.Context, orgID organization.ID, userID user.ID) error {
	tag, err := r.Pool.Exec(ctx, `
		DELETE FROM org_members
		WHERE org_id = $1 AND user_id = $2
	`, string(orgID), string(userID))
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

type membershipScanner interface {
	Scan(...any) error
}

func scanMembership(row membershipScanner) (organization.Membership, error) {
	var (
		orgID, userID, role string
		invitedAt           time.Time
		acceptedAt          *time.Time
	)
	err := row.Scan(&orgID, &userID, &role, &invitedAt, &acceptedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return organization.Membership{}, domain.ErrNotFound
	}
	if err != nil {
		return organization.Membership{}, fmt.Errorf("scan membership: %w", err)
	}
	return organization.Membership{
		OrgID:      organization.ID(orgID),
		UserID:     user.ID(userID),
		Role:       user.Role(role),
		InvitedAt:  invitedAt,
		AcceptedAt: acceptedAt,
	}, nil
}
