// SPDX-License-Identifier: AGPL-3.0-or-later

// Package auditlog defines the audit-log domain type plus the stable
// action enum written to the audit_logs table (M13).
//
// Audit writes are cross-cutting side effects: they MUST NOT fail the
// business operation that triggered them. All action strings are stable
// contract - changing or removing one is a breaking change for any
// downstream SIEM/log analyser.
package auditlog

// Resource types used in audit_logs.resource_type.
const (
	ResourceUser         = "user"
	ResourceSession      = "session"
	ResourceVault        = "vault"
	ResourceOrganization = "organization"
	ResourceAPIKey       = "api_key"
	ResourceInvite       = "invite"
	ResourceBackup       = "backup_destination"
)

// Stable action identifiers. Format: "<domain>.<verb>" in lowercase snake.
// NEVER change or remove an existing action string - downstream consumers
// treat them as contract.
const (
	// Authentication + session lifecycle.
	ActionLoginSuccess       = "login.success"
	ActionLoginFailed        = "login.failed"
	ActionLoginFailedNoUser  = "login.failed.unknown_email"
	ActionLogout             = "auth.logout"
	ActionRefreshed          = "auth.refreshed"
	ActionStepUp             = "auth.step_up"
	ActionPasswordChanged    = "auth.password_changed"
	ActionRecoveryReset      = "auth.recovery_reset"
	ActionRecoveryKitRotated = "auth.recovery_kit_rotated"
	ActionTOTPEnabled        = "auth.totp_enabled"
	ActionTOTPDisabled       = "auth.totp_disabled"
	ActionSessionRevoked     = "session.revoked"

	// Vault + sharing lifecycle.
	ActionVaultCreated       = "vault.created"
	ActionVaultDeleted       = "vault.deleted"
	ActionVaultRekeyed       = "vault.rekeyed"
	ActionVaultMemberAdded   = "vault.member_added"
	ActionVaultMemberRemoved = "vault.member_removed"

	// Organisation lifecycle.
	ActionOrgCreated       = "org.created"
	ActionOrgRoleChanged   = "org.role_changed"
	ActionOrgMemberRemoved = "org.member_removed"

	// API key lifecycle.
	ActionAPIKeyCreated = "api_key.created"
	ActionAPIKeyRevoked = "api_key.revoked"

	// Invite lifecycle.
	ActionInviteCreated = "invite.created"
	ActionInviteRevoked = "invite.revoked"

	// Admin / maintenance.
	ActionBackupRun = "backup.run"

	// Per-user backup destinations (sync).
	ActionBackupConfigured = "backup.configured"
	ActionBackupRemoved    = "backup.removed"
	ActionBackupRestored   = "backup.restored"
)
