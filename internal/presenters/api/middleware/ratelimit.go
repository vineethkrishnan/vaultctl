// SPDX-License-Identifier: AGPL-3.0-or-later

package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

// RateLimiter enforces the H3 three-layer policy: per-IP, per-email, and
// a global circuit breaker. v1 is in-memory (single-instance); cloud tier
// will swap to Redis per architecture §12.2.
type RateLimiter struct {
	mu             sync.Mutex
	perIP          map[string]*bucket
	perEmail       map[string]*bucket
	PerIPLimit     int
	PerIPWindow    time.Duration
	PerEmailLimit  int
	PerEmailWindow time.Duration
	Clock          ports.Clock
}

type bucket struct {
	count     int
	windowEnd time.Time
}

// NewRateLimiter constructs a limiter with the given parameters.
func NewRateLimiter(clk ports.Clock, perIP int, perIPWindow time.Duration, perEmail int, perEmailWindow time.Duration) *RateLimiter {
	return &RateLimiter{
		perIP: map[string]*bucket{}, perEmail: map[string]*bucket{},
		PerIPLimit: perIP, PerIPWindow: perIPWindow,
		PerEmailLimit: perEmail, PerEmailWindow: perEmailWindow,
		Clock: clk,
	}
}

// PerIP is the generic rate-limit middleware (60/min default).
func (l *RateLimiter) PerIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := clientIP(r)
		if !l.hit(l.perIP, key, l.PerIPLimit, l.PerIPWindow) {
			writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "per-IP rate limit")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// AuthAttempt is the per-email limiter for auth endpoints. It enforces both
// the IP bucket AND the per-email bucket (H3 — either breach fails).
// The email is extracted via the `extract` function so handlers can pass
// either a request-body read or header read.
func (l *RateLimiter) AuthAttempt(extract func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := clientIP(r)
			if !l.hit(l.perIP, "auth:"+ip, l.PerIPLimit, l.PerIPWindow) {
				writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "per-IP rate limit")
				return
			}
			email := strings.ToLower(strings.TrimSpace(extract(r)))
			// Per-email throttling counts ONLY failed credential attempts, so
			// signing in legitimately from several clients (web, extension,
			// Touch ID re-login) never trips it — only repeated wrong-password
			// guesses do. A successful attempt clears the counter outright.
			if email != "" && l.overLimit(l.perEmail, email, l.PerEmailLimit) {
				writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "per-email rate limit")
				return
			}
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			if email == "" {
				return
			}
			switch {
			case authAttemptFailed(rec.status):
				l.recordFailure(l.perEmail, email, l.PerEmailWindow)
			case rec.status < 300:
				l.reset(l.perEmail, email)
			}
		})
	}
}

// statusRecorder captures the response status so AuthAttempt can tell a failed
// credential attempt from a successful one after the handler runs.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// authAttemptFailed reports whether a status code represents a failed
// credential attempt worth counting toward the per-email limit. 401 (invalid
// credentials) and 423 (account locked) are the brute-force signals; 2xx and
// benign 4xx (validation, conflict) are not.
func authAttemptFailed(status int) bool {
	return status == http.StatusUnauthorized || status == http.StatusLocked
}

// overLimit reports whether key has reached limit within its current window,
// WITHOUT recording an attempt.
func (l *RateLimiter) overLimit(m map[string]*bucket, key string, limit int) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := m[key]
	if !ok || b.windowEnd.Before(l.Clock.Now()) {
		return false
	}
	return b.count >= limit
}

// recordFailure increments the counter for key, starting a fresh window when
// none is active.
func (l *RateLimiter) recordFailure(m map[string]*bucket, key string, window time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.Clock.Now()
	b, ok := m[key]
	if !ok || b.windowEnd.Before(now) {
		m[key] = &bucket{count: 1, windowEnd: now.Add(window)}
		return
	}
	b.count++
}

// reset clears the counter for key, used after a successful attempt.
func (l *RateLimiter) reset(m map[string]*bucket, key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(m, key)
}

func (l *RateLimiter) hit(m map[string]*bucket, key string, limit int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.Clock.Now()
	b, ok := m[key]
	if !ok || b.windowEnd.Before(now) {
		m[key] = &bucket{count: 1, windowEnd: now.Add(window)}
		return true
	}
	if b.count >= limit {
		return false
	}
	b.count++
	return true
}

// clientIP returns the validated client IP for rate-limit bucketing.
// r.RemoteAddr is the single source of truth — the RealIP middleware
// upstream has already resolved it against the trusted-proxy list, so
// X-Forwarded-For cannot be spoofed past this point.
func clientIP(r *http.Request) string {
	host := r.RemoteAddr
	if idx := strings.LastIndex(host, ":"); idx > 0 {
		host = host[:idx]
	}
	return host
}
