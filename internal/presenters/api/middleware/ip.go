package middleware

import (
	"net"
	"net/http"
	"strings"
)

// AnonymiseIP reduces a raw IP to its tiered-retention prefix per
// architecture §12 / PRD §5.3: IPv4 to /24, IPv6 to /56. Returns an
// empty string when the input is not a parseable address so the
// caller can store SQL NULL.
//
// Input may be a bare address ("203.0.113.7") or a host:port pair
// ("203.0.113.7:54321"). Both are accepted.
func AnonymiseIP(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	// Strip optional :port or [v6]:port.
	if host, _, err := net.SplitHostPort(raw); err == nil {
		raw = host
	}
	// Bracketed v6 without port: [::1]
	raw = strings.TrimPrefix(strings.TrimSuffix(raw, "]"), "[")

	addr := net.ParseIP(raw)
	if addr == nil {
		return ""
	}
	if v4 := addr.To4(); v4 != nil {
		// Truncate to /24: zero the last octet.
		v4[3] = 0
		return v4.String()
	}
	// IPv6: truncate to /56 (first 56 bits = first 7 bytes).
	v6 := addr.To16()
	if v6 == nil {
		return ""
	}
	mask := net.CIDRMask(56, 128)
	for i := range v6 {
		v6[i] &= mask[i]
	}
	return v6.String()
}

// ClientIP extracts the anonymised client IP from an HTTP request. It
// prefers X-Forwarded-For (first hop), falling back to r.RemoteAddr.
// Returns the tiered-retention form (/24 v4, /56 v6). Returns empty
// when nothing can be parsed.
func ClientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// First hop only — subsequent entries can be client-spoofed.
		if idx := strings.IndexByte(xff, ','); idx >= 0 {
			xff = xff[:idx]
		}
		if ip := AnonymiseIP(xff); ip != "" {
			return ip
		}
	}
	return AnonymiseIP(r.RemoteAddr)
}
