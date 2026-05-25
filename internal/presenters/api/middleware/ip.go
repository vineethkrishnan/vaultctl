// SPDX-License-Identifier: AGPL-3.0-or-later

package middleware

import (
	"fmt"
	"net"
	"net/http"
	"strings"
)

// ParseTrustedProxies compiles a list of CIDR strings into IPNets.
// Bare IPs ("10.0.0.5") are accepted and treated as /32 (v4) or /128 (v6).
// Returns an error on the first malformed entry so misconfiguration
// fails loudly at startup instead of silently disabling spoof protection.
func ParseTrustedProxies(cidrs []string) ([]*net.IPNet, error) {
	out := make([]*net.IPNet, 0, len(cidrs))
	for _, raw := range cidrs {
		s := strings.TrimSpace(raw)
		if s == "" {
			continue
		}
		if !strings.Contains(s, "/") {
			if ip := net.ParseIP(s); ip != nil {
				if ip.To4() != nil {
					s += "/32"
				} else {
					s += "/128"
				}
			}
		}
		_, n, err := net.ParseCIDR(s)
		if err != nil {
			return nil, fmt.Errorf("trusted proxy %q: %w", raw, err)
		}
		out = append(out, n)
	}
	return out, nil
}

func containsIP(nets []*net.IPNet, ip net.IP) bool {
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// resolveClientIP walks X-Forwarded-For right-to-left, accepting an entry
// only when the previous hop (peer for the rightmost entry, the next-right
// XFF value for the rest) sits in trusted. The first entry whose previous
// hop is NOT trusted is the real client. If trusted is empty or no XFF is
// present, the peer is returned verbatim.
//
// This is the spoof-resistant alternative to chi's deprecated RealIP —
// a client setting X-Forwarded-For directly cannot bypass it because the
// peer (their own connection) must itself be in the trust list before any
// XFF value is honoured.
func resolveClientIP(remoteAddr, xff string, trusted []*net.IPNet) string {
	peer := remoteAddr
	if host, _, err := net.SplitHostPort(peer); err == nil {
		peer = host
	}
	peer = strings.TrimPrefix(strings.TrimSuffix(peer, "]"), "[")

	if len(trusted) == 0 || xff == "" {
		return peer
	}
	peerIP := net.ParseIP(peer)
	if peerIP == nil || !containsIP(trusted, peerIP) {
		return peer
	}

	parts := strings.Split(xff, ",")
	for i := len(parts) - 1; i >= 0; i-- {
		entry := strings.TrimSpace(parts[i])
		ip := net.ParseIP(entry)
		if ip == nil {
			return peer
		}
		if !containsIP(trusted, ip) {
			return entry
		}
	}
	// Every XFF hop is trusted — fall through to the leftmost entry.
	return strings.TrimSpace(parts[0])
}

// RealIP returns middleware that rewrites r.RemoteAddr to the
// trusted-proxy-validated client IP before downstream handlers run.
// Replaces chi's middleware.RealIP, which trusts X-Forwarded-For
// unconditionally (GHSA-3fxj-6jh8-hvhx et al).
//
// Downstream code — rate limiter, audit log, ClientIP — can read
// r.RemoteAddr as the single source of truth.
func RealIP(trusted []*net.IPNet) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			xff := r.Header.Get("X-Forwarded-For")
			if resolved := resolveClientIP(r.RemoteAddr, xff, trusted); resolved != "" {
				r.RemoteAddr = resolved
			}
			next.ServeHTTP(w, r)
		})
	}
}

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

// ClientIP returns the anonymised client IP for r. It reads r.RemoteAddr,
// which the RealIP middleware has rewritten to the trusted-proxy-validated
// peer — so audit logs and rate limiting share one IP source.
func ClientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	return AnonymiseIP(r.RemoteAddr)
}
