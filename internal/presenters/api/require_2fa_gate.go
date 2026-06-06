// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"log/slog"
	"net/http"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// NewRequire2FAGate returns middleware that blocks mutating requests from
// accounts without TOTP enabled when the deployment enforces 2FA
// (VAULTCTL_REQUIRE_2FA). Reads (GET/HEAD) pass through so the user can still
// view their vault, and the gate is only mounted on the vault data routes -
// login and the /auth/totp/* enrolment routes stay reachable so the user can
// turn 2FA on and unblock themselves.
//
// A user-lookup failure fails OPEN (the request proceeds): like the email gate,
// this is a policy nudge enforced at the edge, not the last line of defense, so
// a transient DB issue must never wrongly lock a user out of their own vault.
func NewRequire2FAGate(users ports.UserRepository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isMutatingMethod(r.Method) {
				next.ServeHTTP(w, r)
				return
			}
			callerID := middleware.CallerID(r.Context())
			if callerID == "" {
				slog.WarnContext(r.Context(), "require_2fa_gate.fail_open", slog.String("reason", "empty caller id"))
				next.ServeHTTP(w, r)
				return
			}
			u, err := users.FindByID(r.Context(), callerID)
			if err != nil {
				slog.WarnContext(r.Context(), "require_2fa_gate.fail_open", slog.String("reason", "user lookup failed"), slog.String("err", err.Error()))
				next.ServeHTTP(w, r)
				return
			}
			if u.TOTPEnabled {
				next.ServeHTTP(w, r)
				return
			}
			var body ErrorBody
			body.Error.Code = "TOTP_REQUIRED"
			body.Error.Message = "This server requires two-factor authentication. Enable TOTP in your security settings to add or change items."
			writeJSON(w, http.StatusForbidden, body)
		})
	}
}
