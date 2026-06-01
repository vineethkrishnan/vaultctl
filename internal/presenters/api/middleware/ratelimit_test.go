// SPDX-License-Identifier: AGPL-3.0-or-later

package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

func newTestLimiter() *RateLimiter {
	// Generous per-IP (1000/min) so only the per-email behaviour is exercised;
	// per-email limit of 3 failures / 15 min.
	return NewRateLimiter(ports.RealClock(), 1000, time.Minute, 3, 15*time.Minute)
}

func staticHandler(status int) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
	})
}

func doAuth(h http.Handler) int {
	req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	req.RemoteAddr = "203.0.113.5:1234"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func extractFn(*http.Request) string { return "a@b.com" }

func TestAuthAttempt_SuccessNeverBlocks(t *testing.T) {
	l := newTestLimiter()
	ok := l.AuthAttempt(extractFn)(staticHandler(http.StatusOK))
	for i := 0; i < 10; i++ {
		if code := doAuth(ok); code != http.StatusOK {
			t.Fatalf("successful login #%d blocked with %d", i+1, code)
		}
	}
}

func TestAuthAttempt_FailuresBlockAfterLimit(t *testing.T) {
	l := newTestLimiter() // limit = 3 failures
	fail := l.AuthAttempt(extractFn)(staticHandler(http.StatusUnauthorized))
	for i := 0; i < 3; i++ {
		if code := doAuth(fail); code != http.StatusUnauthorized {
			t.Fatalf("failure #%d: got %d, want 401", i+1, code)
		}
	}
	if code := doAuth(fail); code != http.StatusTooManyRequests {
		t.Fatalf("4th failure: got %d, want 429", code)
	}
}

func TestAuthAttempt_SuccessResetsCounter(t *testing.T) {
	l := newTestLimiter() // limit = 3
	fail := l.AuthAttempt(extractFn)(staticHandler(http.StatusUnauthorized))
	ok := l.AuthAttempt(extractFn)(staticHandler(http.StatusOK))

	doAuth(fail)
	doAuth(fail) // 2 failures banked
	if code := doAuth(ok); code != http.StatusOK {
		t.Fatalf("success after 2 failures was blocked with %d", code)
	}
	// The success cleared the counter, so a full 3 failures are allowed again.
	for i := 0; i < 3; i++ {
		if code := doAuth(fail); code != http.StatusUnauthorized {
			t.Fatalf("post-reset failure #%d: got %d, want 401", i+1, code)
		}
	}
	if code := doAuth(fail); code != http.StatusTooManyRequests {
		t.Fatalf("expected block after reset+3 failures, got %d", code)
	}
}
