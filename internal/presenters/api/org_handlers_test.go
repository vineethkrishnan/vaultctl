// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/auth"
	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// stubOrgRepo satisfies ports.OrganizationRepository for the handler test by
// embedding the interface (nil) and overriding only ListForUser.
type stubOrgRepo struct {
	ports.OrganizationRepository
	gotUserID user.ID
	orgs      []organization.UserOrg
}

func (s *stubOrgRepo) ListForUser(_ context.Context, userID user.ID) ([]organization.UserOrg, error) {
	s.gotUserID = userID
	return s.orgs, nil
}

func TestHandleListMyOrgs(t *testing.T) {
	joined := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	repo := &stubOrgRepo{orgs: []organization.UserOrg{
		{ID: "org-1", Name: "Acme", Role: user.RoleOwner, JoinedAt: joined},
		{ID: "org-2", Name: "Globex", Role: user.RoleMember, JoinedAt: joined},
	}}
	h := &OrgHandlers{ListMyOrgs: &auth.ListMyOrgs{Orgs: repo}}

	authMW := middleware.RequireJWT(fakeTokenIssuer{userID: "user-42", role: "member"})
	handler := authMW(http.HandlerFunc(h.HandleListMyOrgs))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/orgs", nil)
	req.Header.Set("Authorization", "Bearer dummy")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if repo.gotUserID != "user-42" {
		t.Errorf("repo called with userID %q, want user-42", repo.gotUserID)
	}

	var body []MyOrgResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body) != 2 {
		t.Fatalf("orgs = %d, want 2", len(body))
	}
	if body[0].ID != "org-1" || body[0].Name != "Acme" || body[0].Role != "owner" {
		t.Errorf("first org mapped wrong: %+v", body[0])
	}
	if body[0].JoinedAt != joined.Format(timeFormat) {
		t.Errorf("joinedAt = %q, want %q", body[0].JoinedAt, joined.Format(timeFormat))
	}
}
