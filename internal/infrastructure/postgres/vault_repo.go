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
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// VaultRepo is the pgx-backed ports.VaultRepository.
type VaultRepo struct{ Pool *Pool }

func (r *VaultRepo) Create(ctx context.Context, v vault.Vault, m vault.Member) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op

	var orgID *string
	if v.OrgID != "" {
		s := v.OrgID
		orgID = &s
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO vaults (id, name, type, org_id, created_by, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
	`, string(v.ID), v.Name, string(v.Type), orgID, string(v.CreatedBy), v.CreatedAt, v.UpdatedAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, encrypted_vault_key, wrap_sender_id, wrap_signature, role, added_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
	`, string(m.VaultID), string(m.UserID), encodeBlob(m.EncryptedVaultKey),
		string(m.SenderID), encodeSig(m.WrapSignature), string(m.Role), m.AddedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *VaultRepo) Get(ctx context.Context, id vault.ID) (vault.Vault, error) {
	row := r.Pool.QueryRow(ctx, `
		SELECT id, name, type, COALESCE(org_id::text,''), created_by, created_at, updated_at
		FROM vaults WHERE id = $1
	`, string(id))
	var (
		vid, name, typ, orgID, creator string
		createdAt, updatedAt           time.Time
	)
	err := row.Scan(&vid, &name, &typ, &orgID, &creator, &createdAt, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return vault.Vault{}, domain.ErrNotFound
	}
	if err != nil {
		return vault.Vault{}, err
	}
	return vault.Vault{
		ID: vault.ID(vid), Name: name, Type: vault.Type(typ), OrgID: orgID,
		CreatedBy: user.ID(creator), CreatedAt: createdAt, UpdatedAt: updatedAt,
	}, nil
}

func (r *VaultRepo) ListForUser(ctx context.Context, userID user.ID) ([]vault.Vault, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT v.id, v.name, v.type, COALESCE(v.org_id::text,''), v.created_by, v.created_at, v.updated_at
		FROM vaults v
		JOIN vault_members m ON m.vault_id = v.id
		WHERE m.user_id = $1 AND m.removed_at IS NULL
		ORDER BY v.created_at
	`, string(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []vault.Vault{}
	for rows.Next() {
		var v vault.Vault
		var vid, typ, orgID, creator string
		if err := rows.Scan(&vid, &v.Name, &typ, &orgID, &creator, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		v.ID = vault.ID(vid)
		v.Type = vault.Type(typ)
		v.OrgID = orgID
		v.CreatedBy = user.ID(creator)
		out = append(out, v)
	}
	return out, rows.Err()
}

// IsActiveMember is the H11/M3 authz bedrock: removed_at IS NULL filter.
func (r *VaultRepo) IsActiveMember(ctx context.Context, userID user.ID, vaultID vault.ID) (user.Role, bool, error) {
	var role string
	err := r.Pool.QueryRow(ctx, `
		SELECT role FROM vault_members WHERE user_id = $1 AND vault_id = $2 AND removed_at IS NULL
	`, string(userID), string(vaultID)).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return user.Role(role), true, nil
}

func (r *VaultRepo) AddMember(ctx context.Context, m vault.Member) error {
	_, err := r.Pool.Exec(ctx, `
		INSERT INTO vault_members (vault_id, user_id, encrypted_vault_key, wrap_sender_id, wrap_signature, role, added_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (vault_id, user_id) DO UPDATE SET
			encrypted_vault_key = EXCLUDED.encrypted_vault_key,
			wrap_sender_id = EXCLUDED.wrap_sender_id,
			wrap_signature = EXCLUDED.wrap_signature,
			role = EXCLUDED.role,
			removed_at = NULL
	`, string(m.VaultID), string(m.UserID), encodeBlob(m.EncryptedVaultKey),
		string(m.SenderID), encodeSig(m.WrapSignature), string(m.Role), m.AddedAt)
	return err
}

// RemoveMember soft-deletes (M3).
func (r *VaultRepo) RemoveMember(ctx context.Context, vaultID vault.ID, userID user.ID) error {
	tag, err := r.Pool.Exec(ctx, `
		UPDATE vault_members SET removed_at = NOW()
		WHERE vault_id = $1 AND user_id = $2 AND removed_at IS NULL
	`, string(vaultID), string(userID))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *VaultRepo) UpdateMemberRole(ctx context.Context, vaultID vault.ID, userID user.ID, role user.Role) error {
	tag, err := r.Pool.Exec(ctx, `
		UPDATE vault_members SET role = $3 WHERE vault_id = $1 AND user_id = $2 AND removed_at IS NULL
	`, string(vaultID), string(userID), string(role))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *VaultRepo) MemberForUser(ctx context.Context, vaultID vault.ID, userID user.ID) (vault.Member, error) {
	var (
		vid, uid, encKey, sender, sig, role string
		addedAt                             time.Time
	)
	err := r.Pool.QueryRow(ctx, `
		SELECT vault_id, user_id, encrypted_vault_key, COALESCE(wrap_sender_id::text,''),
		       wrap_signature, role, added_at
		FROM vault_members WHERE vault_id = $1 AND user_id = $2 AND removed_at IS NULL
	`, string(vaultID), string(userID)).Scan(&vid, &uid, &encKey, &sender, &sig, &role, &addedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return vault.Member{}, domain.ErrNotFound
	}
	if err != nil {
		return vault.Member{}, err
	}
	blob, err := decodeBlob(encKey)
	if err != nil {
		return vault.Member{}, fmt.Errorf("decode vault key: %w", err)
	}
	sigv, err := decodeSig(sig)
	if err != nil {
		return vault.Member{}, err
	}
	return vault.Member{
		VaultID: vault.ID(vid), UserID: user.ID(uid), EncryptedVaultKey: blob,
		SenderID: user.ID(sender), WrapSignature: sigv, Role: user.Role(role), AddedAt: addedAt,
	}, nil
}

// ListSharedByOrgMember returns shared-vault IDs within an org where the
// target user is an active member. Used to cascade rekey on org removal.
func (r *VaultRepo) ListSharedByOrgMember(ctx context.Context, orgID organization.ID, userID user.ID) ([]vault.ID, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT v.id
		FROM vaults v
		JOIN vault_members m ON m.vault_id = v.id
		WHERE v.org_id = $1
		  AND v.type = 'shared'
		  AND m.user_id = $2
		  AND m.removed_at IS NULL
		ORDER BY v.created_at
	`, string(orgID), string(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []vault.ID{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, vault.ID(id))
	}
	return out, rows.Err()
}

func (r *VaultRepo) ListMembers(ctx context.Context, vaultID vault.ID) ([]vault.Member, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT vault_id, user_id, encrypted_vault_key, COALESCE(wrap_sender_id::text,''),
		       wrap_signature, role, added_at
		FROM vault_members WHERE vault_id = $1 AND removed_at IS NULL
	`, string(vaultID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []vault.Member{}
	for rows.Next() {
		var (
			vid, uid, encKey, sender, sig, role string
			addedAt                             time.Time
		)
		if err := rows.Scan(&vid, &uid, &encKey, &sender, &sig, &role, &addedAt); err != nil {
			return nil, err
		}
		blob, err := decodeBlob(encKey)
		if err != nil {
			return nil, fmt.Errorf("decode vault key: %w", err)
		}
		sigv, err := decodeSig(sig)
		if err != nil {
			return nil, err
		}
		out = append(out, vault.Member{
			VaultID: vault.ID(vid), UserID: user.ID(uid), EncryptedVaultKey: blob,
			SenderID: user.ID(sender), WrapSignature: sigv, Role: user.Role(role), AddedAt: addedAt,
		})
	}
	return out, rows.Err()
}
