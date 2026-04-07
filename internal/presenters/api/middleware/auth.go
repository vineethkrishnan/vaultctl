// Package middleware hosts the HTTP middleware stack: JWT auth, rate
// limiting, step-up enforcement, security headers, body redaction, audit.
package middleware

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// contextKey is a private type to avoid collisions with other packages'
// context values.
type contextKey struct{ name string }

var (
	ctxCallerID   = &contextKey{"caller_id"}
	ctxCallerRole = &contextKey{"caller_role"}
	ctxClaims     = &contextKey{"access_claims"}
)

// CallerID returns the authenticated user ID from the request context.
// Returns zero value when anonymous.
func CallerID(ctx context.Context) user.ID {
	v, _ := ctx.Value(ctxCallerID).(user.ID)
	return v
}

// CallerRole returns the caller's global role.
func CallerRole(ctx context.Context) user.Role {
	v, _ := ctx.Value(ctxCallerRole).(user.Role)
	return v
}

// CallerClaims returns the full parsed claims (including step-up state).
func CallerClaims(ctx context.Context) (ports.AccessClaims, bool) {
	v, ok := ctx.Value(ctxClaims).(ports.AccessClaims)
	return v, ok
}

// RequireJWT verifies the Authorization: Bearer <jwt> header and injects
// caller identity into the request context. Rejects missing/invalid tokens
// with 401.
func RequireJWT(tokens ports.TokenIssuer) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tok, ok := extractBearer(r.Header.Get("Authorization"))
			if !ok {
				writeErr(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing bearer token")
				return
			}
			claims, err := tokens.Verify(tok)
			if err != nil {
				writeErr(w, http.StatusUnauthorized, "TOKEN_INVALID", "invalid or expired token")
				return
			}
			ctx := r.Context()
			ctx = context.WithValue(ctx, ctxCallerID, user.ID(claims.UserID))
			ctx = context.WithValue(ctx, ctxCallerRole, user.Role(claims.Role))
			ctx = context.WithValue(ctx, ctxClaims, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireRole gates an endpoint behind a minimum global role. Must be
// chained AFTER RequireJWT.
func RequireRole(min user.Role) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !CallerRole(r.Context()).AtLeast(min) {
				writeErr(w, http.StatusForbidden, "FORBIDDEN", "insufficient role")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireStepUp enforces H10: the presented token MUST carry a fresh
// step-up claim. Must be chained AFTER RequireJWT.
func RequireStepUp(clock ports.Clock) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := CallerClaims(r.Context())
			if !ok || !claims.HasValidStepUp(clock.Now()) {
				writeErr(w, http.StatusForbidden, "STEP_UP_REQUIRED", "this endpoint requires recent master-password reverification")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func extractBearer(h string) (string, bool) {
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 {
		return "", false
	}
	if !strings.EqualFold(parts[0], "Bearer") {
		return "", false
	}
	return strings.TrimSpace(parts[1]), parts[1] != ""
}

// ErrUnauthorized is the sentinel middleware tests use.
var ErrUnauthorized = errors.New("middleware: unauthorized")
