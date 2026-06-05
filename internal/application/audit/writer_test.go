// SPDX-License-Identifier: AGPL-3.0-or-later

package audit

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/auditlog"
)

// ===========================================================================
// Fakes
// ===========================================================================

type fakeRepo struct {
	mu      sync.Mutex
	entries []auditlog.Entry
	err     error
}

func (r *fakeRepo) Write(_ context.Context, entry auditlog.Entry) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return r.err
	}
	r.entries = append(r.entries, entry)
	return nil
}

func (r *fakeRepo) take() []auditlog.Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := r.entries
	r.entries = nil
	return out
}

func newTestWriter() (*Writer, *fakeRepo) {
	repo := &fakeRepo{}
	fixed := time.Date(2026, 4, 11, 12, 0, 0, 0, time.UTC)
	w := &Writer{
		Repo:   repo,
		Clock:  ports.ClockFunc(func() time.Time { return fixed }),
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	return w, repo
}

// ===========================================================================
// Entry construction
// ===========================================================================

func TestWriter_LoginSuccess(t *testing.T) {
	w, repo := newTestWriter()
	w.LoginSuccess(context.Background(), "u-1", "203.0.113.0", "curl/8")

	entries := repo.take()
	if len(entries) != 1 {
		t.Fatalf("want 1 entry, got %d", len(entries))
	}
	got := entries[0]
	if got.Action != auditlog.ActionLoginSuccess {
		t.Errorf("action = %q", got.Action)
	}
	if got.UserID != "u-1" {
		t.Errorf("user_id = %q", got.UserID)
	}
	if got.ResourceType != auditlog.ResourceUser || got.ResourceID != "u-1" {
		t.Errorf("resource = %q/%q", got.ResourceType, got.ResourceID)
	}
	if got.IPAddress != "203.0.113.0" {
		t.Errorf("ip = %q", got.IPAddress)
	}
	if got.UserAgent != "curl/8" {
		t.Errorf("ua = %q", got.UserAgent)
	}
	if got.CreatedAt.IsZero() {
		t.Error("created_at not stamped")
	}
}

func TestWriter_LoginFailedUnknownEmail_WritesNullUser(t *testing.T) {
	w, repo := newTestWriter()
	w.LoginFailedUnknownEmail(context.Background(), "203.0.113.0", "")

	entries := repo.take()
	if len(entries) != 1 {
		t.Fatalf("want 1 entry, got %d", len(entries))
	}
	got := entries[0]
	if got.Action != auditlog.ActionLoginFailedNoUser {
		t.Errorf("action = %q", got.Action)
	}
	if got.UserID != "" {
		t.Errorf("user_id should be empty, got %q", got.UserID)
	}
}

func TestWriter_VaultMemberAdded_WritesPairedRows(t *testing.T) {
	w, repo := newTestWriter()
	w.VaultMemberAdded(context.Background(), "owner", "v-1", "target", "ip", "ua")

	entries := repo.take()
	if len(entries) != 2 {
		t.Fatalf("want 2 paired rows, got %d", len(entries))
	}
	if entries[0].ResourceType != auditlog.ResourceVault || entries[0].ResourceID != "v-1" {
		t.Errorf("first row not vault-scoped: %+v", entries[0])
	}
	if entries[1].ResourceType != auditlog.ResourceUser || entries[1].ResourceID != "target" {
		t.Errorf("second row not user-scoped: %+v", entries[1])
	}
}

func TestWriter_OrgMemberRemoved_WritesPairedRows(t *testing.T) {
	w, repo := newTestWriter()
	w.OrgMemberRemoved(context.Background(), "admin", "org-1", "target", "ip", "ua")
	if got := len(repo.take()); got != 2 {
		t.Fatalf("want 2 paired rows, got %d", got)
	}
}

func TestWriter_OrgRoleChanged_WritesPairedRows(t *testing.T) {
	w, repo := newTestWriter()
	w.OrgRoleChanged(context.Background(), "admin", "org-1", "target", "ip", "ua")
	if got := len(repo.take()); got != 2 {
		t.Fatalf("want 2 paired rows, got %d", got)
	}
}

func TestWriter_VaultMemberRemoved_WritesPairedRows(t *testing.T) {
	w, repo := newTestWriter()
	w.VaultMemberRemoved(context.Background(), "admin", "v-1", "target", "ip", "ua")
	if got := len(repo.take()); got != 2 {
		t.Fatalf("want 2 paired rows, got %d", got)
	}
}

// ===========================================================================
// Action surface - exercises every single-row method
// ===========================================================================

func TestWriter_SingleRowActions(t *testing.T) {
	cases := []struct {
		name   string
		call   func(*Writer)
		action string
	}{
		{"logout", func(w *Writer) { w.Logout(ctx(), "u", "s", "ip", "ua") }, auditlog.ActionLogout},
		{"refreshed", func(w *Writer) { w.Refreshed(ctx(), "u", "s", "ip", "ua") }, auditlog.ActionRefreshed},
		{"step_up", func(w *Writer) { w.StepUp(ctx(), "u", "ip", "ua") }, auditlog.ActionStepUp},
		{"password_changed", func(w *Writer) { w.PasswordChanged(ctx(), "u", "ip", "ua") }, auditlog.ActionPasswordChanged},
		{"recovery_reset", func(w *Writer) { w.RecoveryReset(ctx(), "u", "ip", "ua") }, auditlog.ActionRecoveryReset},
		{"totp_enabled", func(w *Writer) { w.TOTPEnabled(ctx(), "u", "ip", "ua") }, auditlog.ActionTOTPEnabled},
		{"totp_disabled", func(w *Writer) { w.TOTPDisabled(ctx(), "u", "ip", "ua") }, auditlog.ActionTOTPDisabled},
		{"session_revoked", func(w *Writer) { w.SessionRevoked(ctx(), "u", "s", "ip", "ua") }, auditlog.ActionSessionRevoked},
		{"vault_created", func(w *Writer) { w.VaultCreated(ctx(), "u", "v", "ip", "ua") }, auditlog.ActionVaultCreated},
		{"vault_rekeyed", func(w *Writer) { w.VaultRekeyed(ctx(), "u", "v", "ip", "ua") }, auditlog.ActionVaultRekeyed},
		{"org_created", func(w *Writer) { w.OrgCreated(ctx(), "u", "o", "ip", "ua") }, auditlog.ActionOrgCreated},
		{"apikey_created", func(w *Writer) { w.APIKeyCreated(ctx(), "u", "k", "ip", "ua") }, auditlog.ActionAPIKeyCreated},
		{"apikey_revoked", func(w *Writer) { w.APIKeyRevoked(ctx(), "u", "k", "ip", "ua") }, auditlog.ActionAPIKeyRevoked},
		{"invite_created", func(w *Writer) { w.InviteCreated(ctx(), "u", "o", "i", "ip", "ua") }, auditlog.ActionInviteCreated},
		{"invite_revoked", func(w *Writer) { w.InviteRevoked(ctx(), "u", "o", "i", "ip", "ua") }, auditlog.ActionInviteRevoked},
		{"backup_run", func(w *Writer) { w.BackupRun(ctx(), "u", "ip", "ua") }, auditlog.ActionBackupRun},
		{"login_failed", func(w *Writer) { w.LoginFailed(ctx(), "u", "ip", "ua") }, auditlog.ActionLoginFailed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w, repo := newTestWriter()
			tc.call(w)
			entries := repo.take()
			if len(entries) != 1 {
				t.Fatalf("want 1 entry, got %d", len(entries))
			}
			if entries[0].Action != tc.action {
				t.Errorf("action = %q, want %q", entries[0].Action, tc.action)
			}
			if entries[0].CreatedAt.IsZero() {
				t.Error("created_at not stamped")
			}
		})
	}
}

// ===========================================================================
// Error handling - audit writes never propagate to the caller
// ===========================================================================

func TestWriter_SwallowsRepoErrors(t *testing.T) {
	repo := &fakeRepo{err: errors.New("db down")}
	w := &Writer{
		Repo:   repo,
		Clock:  ports.RealClock(),
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	// Must not panic, must not return - just quietly log.
	w.LoginSuccess(context.Background(), "u-1", "ip", "ua")
}

func TestWriter_NilSafe(t *testing.T) {
	var w *Writer
	// A nil Writer must be a no-op - tests that don't want audit must
	// not have to mock anything.
	w.LoginSuccess(context.Background(), "u-1", "ip", "ua")
}

func TestNewNoop_DoesNotPanic(t *testing.T) {
	w := NewNoop()
	w.LoginSuccess(context.Background(), "u-1", "ip", "ua")
}

// ===========================================================================
// helpers
// ===========================================================================

func ctx() context.Context { return context.Background() }
