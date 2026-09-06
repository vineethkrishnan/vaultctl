// SPDX-License-Identifier: AGPL-3.0-or-later

// Package notifications builds the in-app notification feed from the audit log
// and tracks per-user read/clear state. There is no separate notification
// store - the feed is a curated, human-readable projection of audit_logs.
package notifications

import (
	"context"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/auditlog"
)

// feedListLimit caps how many recent events the feed returns.
const feedListLimit = 50

// meta describes how an audit action is rendered in the feed.
type meta struct {
	title    string
	category string
}

const (
	categorySecurity = "security"
	categoryVault    = "vault"
	categoryAccount  = "account"
	categoryBackup   = "backup"
)

// feedActions is the curated allow-list: noisy/internal actions (token
// refresh, step-up, unknown-email failures) are intentionally excluded.
var feedActions = map[string]meta{
	auditlog.ActionLoginSuccess:       {"New sign-in", categorySecurity},
	auditlog.ActionLoginFailed:        {"Failed sign-in attempt", categorySecurity},
	auditlog.ActionLogout:             {"Signed out", categorySecurity},
	auditlog.ActionPasswordChanged:    {"Master password changed", categorySecurity},
	auditlog.ActionRecoveryReset:      {"Password reset via recovery key", categorySecurity},
	auditlog.ActionRecoveryKitRotated: {"Recovery kit regenerated", categorySecurity},
	auditlog.ActionTOTPEnabled:        {"Two-factor authentication enabled", categorySecurity},
	auditlog.ActionTOTPDisabled:       {"Two-factor authentication disabled", categorySecurity},
	auditlog.ActionSessionRevoked:     {"A session was signed out", categorySecurity},
	auditlog.ActionVaultCreated:       {"Vault created", categoryVault},
	auditlog.ActionVaultRekeyed:       {"Vault re-keyed", categoryVault},
	auditlog.ActionVaultMemberAdded:   {"Member added to a vault", categoryVault},
	auditlog.ActionVaultMemberRemoved: {"Member removed from a vault", categoryVault},
	auditlog.ActionOrgCreated:         {"Organisation created", categoryAccount},
	auditlog.ActionOrgRoleChanged:     {"A member's role changed", categoryAccount},
	auditlog.ActionOrgMemberRemoved:   {"A member was removed", categoryAccount},
	auditlog.ActionAPIKeyCreated:      {"API key created", categoryAccount},
	auditlog.ActionAPIKeyRevoked:      {"API key revoked", categoryAccount},
	auditlog.ActionInviteCreated:      {"Invite created", categoryAccount},
	auditlog.ActionInviteRevoked:      {"Invite revoked", categoryAccount},
	auditlog.ActionBackupConfigured:   {"Backup destination configured", categoryBackup},
	auditlog.ActionBackupRemoved:      {"Backup destination removed", categoryBackup},
	auditlog.ActionBackupRestored:     {"Backup restored", categoryBackup},
}

func curatedActions() []string {
	actions := make([]string, 0, len(feedActions))
	for a := range feedActions {
		actions = append(actions, a)
	}
	return actions
}

// Notification is one feed item.
type Notification struct {
	ID        string
	Action    string
	Title     string
	Category  string
	CreatedAt time.Time
	Read      bool
}

// Service builds the feed and updates read/clear state.
type Service struct {
	Audit ports.AuditLogReader
	State ports.NotificationStateRepository
	Clock ports.Clock
}

// List returns the curated feed (newest first) plus the unread count.
func (s *Service) List(ctx context.Context, userID string) ([]Notification, int, error) {
	state, err := s.State.Get(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	var after time.Time
	if state.ClearedAt != nil {
		after = *state.ClearedAt
	}
	entries, err := s.Audit.ListForUser(ctx, userID, curatedActions(), after, feedListLimit)
	if err != nil {
		return nil, 0, err
	}

	items := make([]Notification, 0, len(entries))
	unread := 0
	for _, e := range entries {
		m := feedActions[e.Action]
		read := state.LastReadAt != nil && !e.CreatedAt.After(*state.LastReadAt)
		if !read {
			unread++
		}
		items = append(items, Notification{
			ID:        e.ID,
			Action:    e.Action,
			Title:     m.title,
			Category:  m.category,
			CreatedAt: e.CreatedAt,
			Read:      read,
		})
	}
	return items, unread, nil
}

// MarkAllRead marks every current feed item as read.
func (s *Service) MarkAllRead(ctx context.Context, userID string) error {
	return s.State.MarkRead(ctx, userID, s.Clock.Now())
}

// ClearAll hides all current events from the feed.
func (s *Service) ClearAll(ctx context.Context, userID string) error {
	return s.State.Clear(ctx, userID, s.Clock.Now())
}
