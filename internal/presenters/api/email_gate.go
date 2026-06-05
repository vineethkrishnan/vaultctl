// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// NewEmailVerifyGate returns middleware that blocks mutating requests from
// accounts still unverified past the grace window, making their vault
// effectively read-only until they confirm their email. Reads (GET/HEAD) pass
// through, as do verified or in-grace accounts.
//
// A user-lookup failure fails OPEN (the request proceeds): this gate is a
// product nudge, not a security boundary, so a transient DB issue must never
// wrongly lock a paying user out of their own vault.
func NewEmailVerifyGate(users ports.UserRepository, clock ports.Clock, grace time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isMutatingMethod(r.Method) {
				next.ServeHTTP(w, r)
				return
			}
			u, err := users.FindByID(r.Context(), middleware.CallerID(r.Context()))
			if err != nil || !blocksMutation(u, clock.Now(), grace) {
				next.ServeHTTP(w, r)
				return
			}
			var body ErrorBody
			body.Error.Code = "EMAIL_VERIFICATION_REQUIRED"
			body.Error.Message = "Verify your email to add or change items. Check your inbox for the code we sent."
			writeJSON(w, http.StatusForbidden, body)
		})
	}
}

// blocksMutation reports whether a loaded user should be denied a write: only
// when unverified AND past the grace window.
func blocksMutation(u user.User, now time.Time, grace time.Duration) bool {
	if u.EmailVerified {
		return false
	}
	return now.Sub(u.CreatedAt) > grace
}

func isMutatingMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}
