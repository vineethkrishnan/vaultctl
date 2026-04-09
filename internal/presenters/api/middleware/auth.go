// Package middleware hosts the HTTP middleware stack: JWT auth, rate
// limiting, step-up enforcement, security headers, body redaction, audit.
package middleware

import (
	"context"
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

// injectCaller sets the caller identity into the request context.
func injectCaller(r *http.Request, id user.ID, role user.Role, claims *ports.AccessClaims) *http.Request {
	ctx := r.Context()
	ctx = context.WithValue(ctx, ctxCallerID, id)
	ctx = context.WithValue(ctx, ctxCallerRole, role)
	if claims != nil {
		ctx = context.WithValue(ctx, ctxClaims, *claims)
	}
	return r.WithContext(ctx)
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
			next.ServeHTTP(w, injectCaller(r, user.ID(claims.UserID), user.Role(claims.Role), &claims))
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

// APIKeyValidator is the interface for validating API keys in middleware.
type APIKeyValidator interface {
	Validate(ctx context.Context, rawKey string) (userID string, err error)
}

// RequireJWTOrAPIKey tries JWT validation first; if that fails, falls back
// to API key validation. Endpoints accept either authentication method.
func RequireJWTOrAPIKey(tokens ports.TokenIssuer, apiKeys APIKeyValidator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tok, ok := extractBearer(r.Header.Get("Authorization"))
			if !ok {
				writeErr(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing bearer token")
				return
			}

			// Try JWT first
			claims, err := tokens.Verify(tok)
			if err == nil {
				next.ServeHTTP(w, injectCaller(r, user.ID(claims.UserID), user.Role(claims.Role), &claims))
				return
			}

			// JWT failed — try API key
			if apiKeys != nil {
				userID, apiErr := apiKeys.Validate(r.Context(), tok)
				if apiErr == nil {
					next.ServeHTTP(w, injectCaller(r, user.ID(userID), user.RoleMember, nil))
					return
				}
			}

			writeErr(w, http.StatusUnauthorized, "TOKEN_INVALID", "invalid or expired token")
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
