// SPDX-License-Identifier: AGPL-3.0-or-later

package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestSecurityHeaders_AppliedToAllResponses asserts the committed
// architecture-§6.4 header set lands on every handler the middleware
// wraps. Regression guard for OWASP ZAP rule 90004 (CORP) and the rest
// of the M15 baseline.
func TestSecurityHeaders_AppliedToAllResponses(t *testing.T) {
	want := map[string]string{
		"Content-Security-Policy":      "default-src 'self'",
		"Strict-Transport-Security":    "max-age=63072000; includeSubDomains; preload",
		"X-Content-Type-Options":       "nosniff",
		"Referrer-Policy":              "no-referrer",
		"Cross-Origin-Opener-Policy":   "same-origin",
		"Cross-Origin-Resource-Policy": "same-origin",
		"X-Frame-Options":              "DENY",
	}

	handler := SecurityHeaders()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	for name, prefix := range want {
		got := rec.Header().Get(name)
		if got == "" {
			t.Errorf("%s header missing", name)
			continue
		}
		if len(prefix) > 0 && len(got) < len(prefix) {
			t.Errorf("%s = %q, expected to start with %q", name, got, prefix)
			continue
		}
		if got[:min(len(prefix), len(got))] != prefix[:min(len(prefix), len(got))] {
			t.Errorf("%s = %q, expected to start with %q", name, got, prefix)
		}
	}
}
