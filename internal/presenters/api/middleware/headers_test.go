// SPDX-License-Identifier: AGPL-3.0-or-later

package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
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

	handler := SecurityHeaders(false)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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

// TestSecurityHeaders_HIBPConnectSrc asserts the HIBP range API is only added to
// connect-src when the breach check is enabled, so deployments that haven't
// opted in keep connect-src locked to 'self'.
func TestSecurityHeaders_HIBPConnectSrc(t *testing.T) {
	const hibpOrigin = "https://api.pwnedpasswords.com"

	cspFor := func(hibpEnabled bool) string {
		handler := SecurityHeaders(hibpEnabled)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/health", nil))
		return rec.Header().Get("Content-Security-Policy")
	}

	if got := cspFor(false); strings.Contains(got, hibpOrigin) {
		t.Errorf("connect-src must not include %s when HIBP is off: %q", hibpOrigin, got)
	}
	enabled := cspFor(true)
	if !strings.Contains(enabled, "connect-src 'self' "+hibpOrigin) {
		t.Errorf("connect-src must include %s when HIBP is on: %q", hibpOrigin, enabled)
	}
}
