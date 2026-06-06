// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/auditlog"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

type fakeAuditReader struct {
	entries     []auditlog.Entry
	gotUserID   string
	gotBefore   time.Time
	gotLimit    int
	returnSlice []auditlog.Entry
}

func (f *fakeAuditReader) ListForUser(context.Context, string, []string, time.Time, int) ([]auditlog.Entry, error) {
	return nil, nil
}

func (f *fakeAuditReader) PageForUser(_ context.Context, userID string, before time.Time, limit int) ([]auditlog.Entry, error) {
	f.gotUserID = userID
	f.gotBefore = before
	f.gotLimit = limit
	return f.returnSlice, nil
}

type fakeTokenIssuer struct{ userID, role string }

func (fakeTokenIssuer) Issue(string, string, time.Time, time.Time) (string, error) {
	return "", nil
}
func (f fakeTokenIssuer) Verify(string) (ports.AccessClaims, error) {
	return ports.AccessClaims{UserID: f.userID, Role: f.role}, nil
}

func serveAudit(t *testing.T, reader ports.AuditLogReader, target string) *httptest.ResponseRecorder {
	t.Helper()
	h := &AuditHandlers{Reader: reader}
	mw := middleware.RequireJWT(fakeTokenIssuer{userID: "user-42", role: "member"})
	handler := mw(http.HandlerFunc(h.HandleListOwnAudit))

	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("Authorization", "Bearer dummy")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestHandleListOwnAuditScopesToCaller(t *testing.T) {
	t1 := time.Date(2026, 6, 6, 10, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 6, 6, 9, 0, 0, 0, time.UTC)
	reader := &fakeAuditReader{returnSlice: []auditlog.Entry{
		{Action: "login.success", IPAddress: "203.0.113.0", UserAgent: "Chrome", CreatedAt: t1},
		{Action: "password.changed", ResourceType: "user", CreatedAt: t2},
	}}

	rec := serveAudit(t, reader, "/api/v1/users/me/audit")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if reader.gotUserID != "user-42" {
		t.Errorf("reader called with userID %q, want user-42", reader.gotUserID)
	}
	if reader.gotLimit != auditDefaultLimit {
		t.Errorf("default limit = %d, want %d", reader.gotLimit, auditDefaultLimit)
	}
	if !reader.gotBefore.IsZero() {
		t.Errorf("before = %v, want zero", reader.gotBefore)
	}

	var body AuditListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(body.Entries))
	}
	if body.Entries[0].Action != "login.success" || body.Entries[0].IPAddress != "203.0.113.0" {
		t.Errorf("first entry mapped wrong: %+v", body.Entries[0])
	}
	// Fewer than the limit returned, so no next cursor.
	if body.NextBefore != "" {
		t.Errorf("NextBefore = %q, want empty", body.NextBefore)
	}
}

func TestHandleListOwnAuditPagination(t *testing.T) {
	cursor := time.Date(2026, 6, 6, 8, 0, 0, 0, time.UTC)
	entries := make([]auditlog.Entry, auditDefaultLimit)
	last := time.Date(2026, 6, 6, 7, 0, 0, 0, time.UTC)
	for i := range entries {
		entries[i] = auditlog.Entry{Action: "login.success", CreatedAt: cursor}
	}
	entries[len(entries)-1].CreatedAt = last
	reader := &fakeAuditReader{returnSlice: entries}

	rec := serveAudit(t, reader, "/api/v1/users/me/audit?limit=50&before="+cursor.Format(time.RFC3339))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !reader.gotBefore.Equal(cursor) {
		t.Errorf("before = %v, want %v", reader.gotBefore, cursor)
	}

	var body AuditListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// A full page was returned, so a next cursor (the oldest createdAt) is set.
	if body.NextBefore != last.Format(time.RFC3339) {
		t.Errorf("NextBefore = %q, want %q", body.NextBefore, last.Format(time.RFC3339))
	}
}

func TestHandleListOwnAuditRejectsBadParams(t *testing.T) {
	reader := &fakeAuditReader{}
	for _, target := range []string{
		"/api/v1/users/me/audit?limit=0",
		"/api/v1/users/me/audit?limit=500",
		"/api/v1/users/me/audit?limit=abc",
		"/api/v1/users/me/audit?before=not-a-time",
	} {
		rec := serveAudit(t, reader, target)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", target, rec.Code)
		}
	}
}
