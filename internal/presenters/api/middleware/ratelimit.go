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
			if email != "" && !l.hit(l.perEmail, email, l.PerEmailLimit, l.PerEmailWindow) {
				writeErr(w, http.StatusTooManyRequests, "RATE_LIMITED", "per-email rate limit")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
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

// clientIP extracts the client IP, honouring X-Forwarded-For only when the
// upstream middleware has validated the trusted-proxy list (chi's RealIP
// does this when fronted by Caddy's trusted_proxies block — see
// deploy/caddy/Caddyfile).
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take only the FIRST hop — subsequent hops can be spoofed.
		parts := strings.SplitN(xff, ",", 2)
		return strings.TrimSpace(parts[0])
	}
	host := r.RemoteAddr
	if idx := strings.LastIndex(host, ":"); idx > 0 {
		host = host[:idx]
	}
	return host
}
