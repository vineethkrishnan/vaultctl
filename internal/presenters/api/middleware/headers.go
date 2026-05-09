// SPDX-License-Identifier: AGPL-3.0-or-later

package middleware

import (
	"net/http"
	"strings"
)

// SecurityHeaders emits the committed CSP + companion headers from
// architecture §6.4 (M8 finding). CSP is tuned for hash-wasm Argon2id
// (`wasm-unsafe-eval` allowance).
func SecurityHeaders() func(http.Handler) http.Handler {
	const csp = "default-src 'self'; " +
		"script-src 'self' 'wasm-unsafe-eval'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data:; " +
		"connect-src 'self'; " +
		"frame-ancestors 'none'; " +
		"base-uri 'self'; " +
		"form-action 'self'"

	// Swagger UI requires unsafe-inline scripts and loads assets from CDN.
	const swaggerCSP = "default-src 'self'; " +
		"script-src 'self' 'unsafe-inline'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data: https://validator.swagger.io; " +
		"connect-src 'self'"

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			if strings.HasPrefix(r.URL.Path, "/swagger/") {
				h.Set("Content-Security-Policy", swaggerCSP)
			} else {
				h.Set("Content-Security-Policy", csp)
			}
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Permissions-Policy", "interest-cohort=(), geolocation=(), camera=(), microphone=()")
			h.Set("Cross-Origin-Opener-Policy", "same-origin")
			h.Set("Cross-Origin-Resource-Policy", "same-site")
			h.Set("X-Frame-Options", "DENY")
			next.ServeHTTP(w, r)
		})
	}
}
