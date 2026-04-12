package ports

import (
	"context"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/auditlog"
	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// AuditLogRepository persists audit_logs rows (M13). The single Write
// method mirrors a single INSERT; the port is intentionally minimal so
// that the cross-cutting audit.Writer facade can be the only caller.
type AuditLogRepository interface {
	// Write persists one audit entry. Errors MUST be logged and swallowed
	// by the caller — an audit write is never allowed to take down a
	// business request.
	Write(ctx context.Context, entry auditlog.Entry) error
}

// UserRepository persists the User aggregate.
//
// Methods marked "raw" carry opaque infrastructure-layer identifiers (e.g.
// auth_hash_fingerprint) that the domain treats as black-box handles. All
// timestamps are authoritative — the repository is responsible for
// serialising them consistently.
type UserRepository interface {
	// Create inserts a new user row with its server-hashed authHash.
	// Returns ErrConflict (via domain sentinels) if the email is taken.
	Create(ctx context.Context, u user.User, authHash string) error

	// FindByEmail loads a user by normalised email. Returns the domain
	// ErrNotFound sentinel when no match.
	FindByEmail(ctx context.Context, email user.Email) (user.User, error)

	// FindByID loads a user by ID.
	FindByID(ctx context.Context, id user.ID) (user.User, error)

	// AuthHash returns the stored server-side auth hash for a user. Split
	// out from the main entity so the hash never rides through domain
	// code paths.
	AuthHash(ctx context.Context, id user.ID) (string, error)

	// UpdateProfile updates the user's mutable profile fields (name).
	UpdateProfile(ctx context.Context, id user.ID, name string) error

	// UpdateAuthHash replaces the stored server-side auth hash. Used when
	// AuthHasher.Verify returns upgrade=true, and on password change.
	UpdateAuthHash(ctx context.Context, id user.ID, authHash string) error

	// UpdatePasswordMaterial atomically updates auth hash + re-encrypted
	// private keys on password change.
	UpdatePasswordMaterial(ctx context.Context, id user.ID, authHash string, encPrivKey, encIDPrivKey []byte) error

	// ApplyFailedLogin increments failed_login_attempts and optionally
	// sets locked_until if the threshold is hit.
	ApplyFailedLogin(ctx context.Context, id user.ID, attempts int, lockedUntil *time.Time) error

	// ResetLoginFailures zeroes failed_login_attempts and locked_until.
	// Called on any successful login.
	ResetLoginFailures(ctx context.Context, id user.ID) error

	// UpdateTOTPCounter records the last-accepted 30s counter (H6).
	UpdateTOTPCounter(ctx context.Context, id user.ID, counter int64) error

	// SetTOTPSecret stores the server-encrypted TOTP secret.
	SetTOTPSecret(ctx context.Context, id user.ID, encryptedSecret []byte) error

	// GetTOTPSecret returns the encrypted TOTP secret and last counter.
	GetTOTPSecret(ctx context.Context, id user.ID) (encryptedSecret []byte, lastCounter int64, err error)

	// EnableTOTP sets totp_enabled = true.
	EnableTOTP(ctx context.Context, id user.ID) error

	// DisableTOTP sets totp_enabled = false and clears the secret.
	DisableTOTP(ctx context.Context, id user.ID) error

	// GetHint returns the server-encrypted password hint for a user
	// identified by email. Returns nil hint when no hint is set.
	GetHint(ctx context.Context, email user.Email) ([]byte, error)

	// GetRecoveryMaterial returns the encrypted key material needed for
	// account recovery. The client uses its recovery key to try decrypting
	// these blobs locally.
	GetRecoveryMaterial(ctx context.Context, email user.Email) (u user.User, err error)

	// UpdatePasswordMaterialAndHint atomically updates auth hash + re-encrypted
	// private keys + optional password hint on recovery/password reset.
	UpdatePasswordMaterialAndHint(ctx context.Context, id user.ID, authHash string, encPrivKey, encIDPrivKey, encHint []byte) error
}

// InviteRepository persists organisation invite tokens (M11).
type InviteRepository interface {
	Create(ctx context.Context, invite organization.Invite) error
	GetByTokenHash(ctx context.Context, tokenHash []byte) (organization.Invite, error)
	GetByID(ctx context.Context, id string) (organization.Invite, error)
	ListByOrg(ctx context.Context, orgID string) ([]organization.Invite, error)
	MarkUsed(ctx context.Context, id string, usedAt time.Time) error
	MarkRevoked(ctx context.Context, id string, revokedAt time.Time) error
}

// APIKeyRepository persists API key rows.
type APIKeyRepository interface {
	Create(ctx context.Context, key user.APIKey) error
	GetByHash(ctx context.Context, keyHash string) (user.APIKey, error)
	ListByUser(ctx context.Context, userID user.ID) ([]user.APIKey, error)
	Delete(ctx context.Context, userID user.ID, keyID user.APIKeyID) error
	UpdateLastUsed(ctx context.Context, keyID user.APIKeyID, now time.Time) error
}

// OrganizationRepository persists Organization + Membership rows.
type OrganizationRepository interface {
	// Create inserts an organization row plus the creator's initial membership.
	Create(ctx context.Context, org organization.Organization, creator organization.Membership) error

	// GetByID loads an organization by ID. Returns ErrNotFound when missing.
	GetByID(ctx context.Context, id organization.ID) (organization.Organization, error)

	// ListMembers returns all members of an organization.
	ListMembers(ctx context.Context, orgID organization.ID) ([]organization.Membership, error)

	// UpdateMemberRole changes a member's org-level role.
	UpdateMemberRole(ctx context.Context, orgID organization.ID, userID user.ID, role user.Role) error

	// GetMembership loads a single org membership row. Returns ErrNotFound
	// when the user is not a member of the org.
	GetMembership(ctx context.Context, orgID organization.ID, userID user.ID) (organization.Membership, error)

	// RemoveMember hard-deletes a member from the org (C2). Shared vault
	// memberships within the org must be revoked separately — see the
	// RemoveOrgMember use case for the full flow.
	RemoveMember(ctx context.Context, orgID organization.ID, userID user.ID) error
}

// SessionStore persists Session rows keyed off the HMAC'd refresh token.
type SessionStore interface {
	Create(ctx context.Context, s user.Session) error
	// FindByTokenHash looks up a session by HMAC'd refresh token (C3). Raw
	// tokens NEVER enter this method.
	FindByTokenHash(ctx context.Context, hash user.RefreshTokenHash) (user.Session, error)
	// Revoke deletes a single session row.
	Revoke(ctx context.Context, id user.SessionID) error
	// Rotate replaces one refresh token hash with another, atomic with a
	// LastRefreshAt touch. Used on refresh.
	Rotate(ctx context.Context, id user.SessionID, newHash user.RefreshTokenHash, at time.Time, expiresAt time.Time) error
	// RevokeAllForUser invalidates all sessions for a user (password change).
	RevokeAllForUser(ctx context.Context, userID user.ID) error
	// PurgeExpired deletes sessions past their expires_at.
	PurgeExpired(ctx context.Context) (int, error)
	// ListForUser returns all un-expired sessions for a user (for the
	// "my sessions" endpoint).
	ListForUser(ctx context.Context, userID user.ID) ([]user.Session, error)
}
