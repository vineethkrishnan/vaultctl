// SPDX-License-Identifier: AGPL-3.0-or-later

// Package audit is a cross-cutting facade over the audit_logs table
// (M13). It is intentionally NOT a use case: audit writes are passive
// side effects of other business operations and must never fail the
// caller's primary flow.
//
// Usage: handlers construct one Writer at wire time and call the
// type-safe per-action methods after their use case returns success.
//
//	h.Audit.PasswordChanged(ctx, userID, ip, ua)
//
// All methods are fire-and-forget from the caller's perspective: any
// repository error is logged at WARN and swallowed.
package audit

import (
	"context"
	"log/slog"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/auditlog"
)

// Writer is the single entry point for every audit write in the
// system. Constructed once at wire time and shared across handlers.
type Writer struct {
	Repo   ports.AuditLogRepository
	Clock  ports.Clock
	Logger *slog.Logger
}

// New builds a Writer. The logger is required so best-effort failures
// have somewhere to go; pass slog.Default() if you have no better.
func New(repo ports.AuditLogRepository, clock ports.Clock, logger *slog.Logger) *Writer {
	if logger == nil {
		logger = slog.Default()
	}
	return &Writer{Repo: repo, Clock: clock, Logger: logger}
}

// NewNoop returns a Writer backed by a do-nothing repository. Handlers
// under test can accept a *Writer without mocking every action method.
func NewNoop() *Writer {
	return &Writer{
		Repo:   noopRepo{},
		Clock:  ports.RealClock(),
		Logger: slog.Default(),
	}
}

// write is the shared tail: stamp the clock, call the repo, swallow
// errors at WARN. Never panics on a nil Writer so tests can pass nil
// through without bothering with NewNoop.
func (w *Writer) write(ctx context.Context, entry auditlog.Entry) {
	if w == nil || w.Repo == nil {
		return
	}
	entry.CreatedAt = w.Clock.Now()
	if err := w.Repo.Write(ctx, entry); err != nil {
		w.Logger.WarnContext(ctx, "audit write failed",
			slog.String("action", entry.Action),
			slog.String("resource_type", entry.ResourceType),
			slog.String("resource_id", entry.ResourceID),
			slog.Any("error", err),
		)
	}
}

// ===========================================================================
// Auth lifecycle
// ===========================================================================

// LoginSuccess records a successful authentication.
func (w *Writer) LoginSuccess(ctx context.Context, userID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionLoginSuccess,
		ResourceType: auditlog.ResourceUser,
		ResourceID:   userID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// LoginFailed records a login failure for a known user. The user ID is
// resolved by the handler BEFORE the 401 is returned; raw emails MUST
// NOT be stored.
func (w *Writer) LoginFailed(ctx context.Context, userID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionLoginFailed,
		ResourceType: auditlog.ResourceUser,
		ResourceID:   userID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// LoginFailedUnknownEmail records a login attempt against an email the
// server does not recognise. User ID is NULL and no email is stored.
func (w *Writer) LoginFailedUnknownEmail(ctx context.Context, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		Action:       auditlog.ActionLoginFailedNoUser,
		ResourceType: auditlog.ResourceUser,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// Logout records a refresh-token revocation. The session ID may be
// empty when the token cannot be matched; the write is still made.
func (w *Writer) Logout(ctx context.Context, userID, sessionID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionLogout,
		ResourceType: auditlog.ResourceSession,
		ResourceID:   sessionID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// Refreshed records a token rotation.
func (w *Writer) Refreshed(ctx context.Context, userID, sessionID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionRefreshed,
		ResourceType: auditlog.ResourceSession,
		ResourceID:   sessionID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// StepUp records a successful master-password reverification (H10).
func (w *Writer) StepUp(ctx context.Context, userID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionStepUp,
		ResourceType: auditlog.ResourceUser,
		ResourceID:   userID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// PasswordChanged records a master-password rotation.
func (w *Writer) PasswordChanged(ctx context.Context, userID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionPasswordChanged,
		ResourceType: auditlog.ResourceUser,
		ResourceID:   userID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// RecoveryReset records a master-password reset via the recovery code
// flow (triggers full re-encryption of private keys).
func (w *Writer) RecoveryReset(ctx context.Context, userID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionRecoveryReset,
		ResourceType: auditlog.ResourceUser,
		ResourceID:   userID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// TOTPEnabled records activation of two-factor authentication.
func (w *Writer) TOTPEnabled(ctx context.Context, userID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionTOTPEnabled,
		ResourceType: auditlog.ResourceUser,
		ResourceID:   userID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// TOTPDisabled records deactivation of two-factor authentication.
func (w *Writer) TOTPDisabled(ctx context.Context, userID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionTOTPDisabled,
		ResourceType: auditlog.ResourceUser,
		ResourceID:   userID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// SessionRevoked records explicit revocation of a single session.
func (w *Writer) SessionRevoked(ctx context.Context, userID, sessionID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionSessionRevoked,
		ResourceType: auditlog.ResourceSession,
		ResourceID:   sessionID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// ===========================================================================
// Vault + sharing lifecycle
// ===========================================================================

// VaultCreated records new-vault provisioning. The creator is always
// the caller.
func (w *Writer) VaultCreated(ctx context.Context, userID, vaultID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionVaultCreated,
		ResourceType: auditlog.ResourceVault,
		ResourceID:   vaultID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// VaultRekeyed records post-member-removal key rotation.
func (w *Writer) VaultRekeyed(ctx context.Context, actorID, vaultID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       actorID,
		Action:       auditlog.ActionVaultRekeyed,
		ResourceType: auditlog.ResourceVault,
		ResourceID:   vaultID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// VaultMemberAdded records a new member being added to a shared vault.
// One row per target user — the audit schema has no free-form meta
// column, so the target is encoded by writing a row per pair.
func (w *Writer) VaultMemberAdded(ctx context.Context, actorID, vaultID, targetUserID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       actorID,
		Action:       auditlog.ActionVaultMemberAdded,
		ResourceType: auditlog.ResourceVault,
		ResourceID:   vaultID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
	// Also record target pairing so forensics can answer "who was
	// added to vault X?" directly. resource_type=user + resource_id=
	// target keeps the row structured.
	w.write(ctx, auditlog.Entry{
		UserID:       actorID,
		Action:       auditlog.ActionVaultMemberAdded,
		ResourceType: auditlog.ResourceUser,
		ResourceID:   targetUserID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// VaultMemberRemoved records soft-removal of a vault member.
func (w *Writer) VaultMemberRemoved(ctx context.Context, actorID, vaultID, targetUserID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       actorID,
		Action:       auditlog.ActionVaultMemberRemoved,
		ResourceType: auditlog.ResourceVault,
		ResourceID:   vaultID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
	w.write(ctx, auditlog.Entry{
		UserID:       actorID,
		Action:       auditlog.ActionVaultMemberRemoved,
		ResourceType: auditlog.ResourceUser,
		ResourceID:   targetUserID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// ===========================================================================
// Organisation lifecycle
// ===========================================================================

// OrgCreated records a new organisation.
func (w *Writer) OrgCreated(ctx context.Context, actorID, orgID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       actorID,
		Action:       auditlog.ActionOrgCreated,
		ResourceType: auditlog.ResourceOrganization,
		ResourceID:   orgID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// OrgRoleChanged records an org-level role change for a member.
func (w *Writer) OrgRoleChanged(ctx context.Context, actorID, orgID, targetUserID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       actorID,
		Action:       auditlog.ActionOrgRoleChanged,
		ResourceType: auditlog.ResourceOrganization,
		ResourceID:   orgID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
	w.write(ctx, auditlog.Entry{
		UserID:       actorID,
		Action:       auditlog.ActionOrgRoleChanged,
		ResourceType: auditlog.ResourceUser,
		ResourceID:   targetUserID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// OrgMemberRemoved records removal of a user from an organisation.
func (w *Writer) OrgMemberRemoved(ctx context.Context, actorID, orgID, targetUserID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       actorID,
		Action:       auditlog.ActionOrgMemberRemoved,
		ResourceType: auditlog.ResourceOrganization,
		ResourceID:   orgID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
	w.write(ctx, auditlog.Entry{
		UserID:       actorID,
		Action:       auditlog.ActionOrgMemberRemoved,
		ResourceType: auditlog.ResourceUser,
		ResourceID:   targetUserID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// ===========================================================================
// API key lifecycle
// ===========================================================================

// APIKeyCreated records a new personal API key.
func (w *Writer) APIKeyCreated(ctx context.Context, userID, keyID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionAPIKeyCreated,
		ResourceType: auditlog.ResourceAPIKey,
		ResourceID:   keyID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// APIKeyRevoked records deletion of a personal API key.
func (w *Writer) APIKeyRevoked(ctx context.Context, userID, keyID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       userID,
		Action:       auditlog.ActionAPIKeyRevoked,
		ResourceType: auditlog.ResourceAPIKey,
		ResourceID:   keyID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// ===========================================================================
// Invite lifecycle
// ===========================================================================

// InviteCreated records issuance of a new org invite.
func (w *Writer) InviteCreated(ctx context.Context, actorID, orgID, inviteID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       actorID,
		Action:       auditlog.ActionInviteCreated,
		ResourceType: auditlog.ResourceInvite,
		ResourceID:   inviteID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// InviteRevoked records cancellation of a pending invite.
func (w *Writer) InviteRevoked(ctx context.Context, actorID, orgID, inviteID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:       actorID,
		Action:       auditlog.ActionInviteRevoked,
		ResourceType: auditlog.ResourceInvite,
		ResourceID:   inviteID,
		IPAddress:    ip,
		UserAgent:    userAgent,
	})
}

// ===========================================================================
// Admin / maintenance
// ===========================================================================

// BackupRun records a backup CLI invocation. actorID is the operator
// who ran the CLI, or empty when it is a scheduled / system job.
func (w *Writer) BackupRun(ctx context.Context, actorID, ip, userAgent string) {
	w.write(ctx, auditlog.Entry{
		UserID:    actorID,
		Action:    auditlog.ActionBackupRun,
		IPAddress: ip,
		UserAgent: userAgent,
	})
}

// ===========================================================================
// noopRepo — used by NewNoop for test wiring
// ===========================================================================

type noopRepo struct{}

func (noopRepo) Write(context.Context, auditlog.Entry) error { return nil }
