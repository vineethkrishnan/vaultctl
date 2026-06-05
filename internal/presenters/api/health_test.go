// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakePinger struct{ err error }

func (f fakePinger) Ping(context.Context) error { return f.err }

func TestHealthHandler(t *testing.T) {
	tests := []struct {
		name           string
		db             Pinger
		wantStatusCode int
		wantStatus     string
		wantDatabase   string
	}{
		{"no db configured", nil, http.StatusOK, "ok", "ok"},
		{"db reachable", fakePinger{nil}, http.StatusOK, "ok", "ok"},
		{"db unreachable", fakePinger{errors.New("connection refused")}, http.StatusServiceUnavailable, "degraded", "down"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
			rec := httptest.NewRecorder()
			healthHandler(tt.db).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatusCode {
				t.Fatalf("status code = %d, want %d", rec.Code, tt.wantStatusCode)
			}

			var body struct {
				Status string            `json:"status"`
				Checks map[string]string `json:"checks"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if body.Status != tt.wantStatus {
				t.Errorf("status = %q, want %q", body.Status, tt.wantStatus)
			}
			if body.Checks["database"] != tt.wantDatabase {
				t.Errorf("checks.database = %q, want %q", body.Checks["database"], tt.wantDatabase)
			}
		})
	}
}
