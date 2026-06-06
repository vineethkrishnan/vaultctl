// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// stubUserRepo satisfies ports.UserRepository for the gate test by embedding
// the interface (nil) and overriding only the method the gate calls.
type stubUserRepo struct {
	ports.UserRepository
	u user.User
}

func (s stubUserRepo) FindByID(context.Context, user.ID) (user.User, error) { return s.u, nil }

func serve2FAGate(t *testing.T, repo ports.UserRepository, method string) *httptest.ResponseRecorder {
	t.Helper()
	gate := NewRequire2FAGate(repo)
	auth := middleware.RequireJWT(fakeTokenIssuer{userID: "user-42", role: "member"})
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	handler := auth(gate(next))

	req := httptest.NewRequest(method, "/api/v1/vaults", nil)
	req.Header.Set("Authorization", "Bearer dummy")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestRequire2FAGate(t *testing.T) {
	tests := []struct {
		name        string
		totpEnabled bool
		method      string
		wantStatus  int
	}{
		{"totp enabled passes mutation", true, http.MethodPost, http.StatusOK},
		{"totp disabled blocks mutation", false, http.MethodPost, http.StatusForbidden},
		{"totp disabled blocks put", false, http.MethodPut, http.StatusForbidden},
		{"totp disabled blocks delete", false, http.MethodDelete, http.StatusForbidden},
		{"totp disabled allows read", false, http.MethodGet, http.StatusOK},
		{"totp enabled allows read", true, http.MethodGet, http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := stubUserRepo{u: user.User{ID: "user-42", TOTPEnabled: tt.totpEnabled}}
			rec := serve2FAGate(t, repo, tt.method)
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if tt.wantStatus == http.StatusForbidden {
				var body ErrorBody
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatalf("decode: %v", err)
				}
				if body.Error.Code != "TOTP_REQUIRED" {
					t.Errorf("error code = %q, want TOTP_REQUIRED", body.Error.Code)
				}
			}
		})
	}
}
