// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/vineethkrishnan/vaultctl/internal/application/audit"
	"github.com/vineethkrishnan/vaultctl/internal/application/digest"
	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// UserHandlers ties HTTP to user profile and session endpoints.
type UserHandlers struct {
	Users    ports.UserRepository
	Sessions ports.SessionStore

	// Digest serves email-digest preferences. Nil when no mailer is wired.
	Digest *digest.Service

	// Audit is the cross-cutting audit-log writer (M13).
	Audit *audit.Writer
}

// HandleGetEmailPreferences returns the caller's email-digest preference.
// @Summary Get email preferences
// @Tags Users
// @Produce json
// @Security BearerAuth
// @Success 200 {object} EmailPreferencesResponse
// @Router /users/me/email-preferences [get]
func (h *UserHandlers) HandleGetEmailPreferences(w http.ResponseWriter, r *http.Request) {
	resp, err := h.emailPreferences(r, middleware.CallerID(r.Context()))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// emailPreferences assembles the caller's current email-preference view.
func (h *UserHandlers) emailPreferences(r *http.Request, callerID user.ID) (EmailPreferencesResponse, error) {
	freq, err := h.Digest.Frequency(r.Context(), callerID)
	if err != nil {
		return EmailPreferencesResponse{}, err
	}
	loginAlerts, err := h.Digest.LoginAlerts(r.Context(), callerID)
	if err != nil {
		return EmailPreferencesResponse{}, err
	}
	u, err := h.Users.FindByID(r.Context(), callerID)
	if err != nil {
		return EmailPreferencesResponse{}, err
	}
	return EmailPreferencesResponse{DigestFrequency: string(freq), LoginAlerts: loginAlerts, Locale: u.Locale}, nil
}

// HandleUpdateEmailPreferences sets the caller's digest frequency.
// @Summary Update email preferences
// @Tags Users
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body UpdateEmailPreferencesRequest true "Preference"
// @Success 200 {object} EmailPreferencesResponse
// @Failure 400 {object} ErrorBody
// @Router /users/me/email-preferences [put]
func (h *UserHandlers) HandleUpdateEmailPreferences(w http.ResponseWriter, r *http.Request) {
	var req UpdateEmailPreferencesRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	callerID := middleware.CallerID(r.Context())

	if req.DigestFrequency != nil {
		freq := digest.Frequency(*req.DigestFrequency)
		if !freq.Valid() {
			writeError(w, r, domain.NewInvalid("digestFrequency", "must be off, daily, weekly, monthly, quarterly or yearly"))
			return
		}
		if err := h.Digest.SetFrequency(r.Context(), callerID, freq); err != nil {
			writeError(w, r, err)
			return
		}
	}
	if req.LoginAlerts != nil {
		if err := h.Digest.SetLoginAlerts(r.Context(), callerID, *req.LoginAlerts); err != nil {
			writeError(w, r, err)
			return
		}
	}
	if req.Locale != nil {
		if !user.IsSupportedLocale(*req.Locale) {
			writeError(w, r, domain.NewInvalid("locale", "must be en or de"))
			return
		}
		if err := h.Users.SetLocale(r.Context(), callerID, *req.Locale); err != nil {
			writeError(w, r, err)
			return
		}
	}

	resp, err := h.emailPreferences(r, callerID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// HandleGetProfile returns the authenticated user's profile.
// @Summary Get user profile
// @Description Returns the profile of the authenticated user
// @Tags Users
// @Produce json
// @Security BearerAuth
// @Success 200 {object} UserProfileResponse
// @Failure 401 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /users/me [get]
func (h *UserHandlers) HandleGetProfile(w http.ResponseWriter, r *http.Request) {
	u, err := h.Users.FindByID(r.Context(), middleware.CallerID(r.Context()))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newUserProfileResponse(u))
}

func newUserProfileResponse(u user.User) UserProfileResponse {
	resp := UserProfileResponse{
		ID:            string(u.ID),
		Email:         u.Email.String(),
		Name:          u.Name,
		Role:          string(u.Role),
		CreatedAt:     u.CreatedAt.UTC().Format(timeFormat),
		EmailVerified: u.EmailVerified,
	}
	if u.EmailVerifiedAt != nil {
		t := u.EmailVerifiedAt.UTC().Format(timeFormat)
		resp.EmailVerifiedAt = &t
	}
	return resp
}

// HandleUpdateProfile updates the authenticated user's profile.
// @Summary Update user profile
// @Description Update the authenticated user's display name
// @Tags Users
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body UpdateProfileRequest true "Profile update payload"
// @Success 200 {object} UserProfileResponse
// @Failure 400 {object} ErrorBody
// @Failure 401 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /users/me [put]
func (h *UserHandlers) HandleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	var req UpdateProfileRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if req.Name == "" {
		writeError(w, r, domain.NewInvalid("name", "required"))
		return
	}
	if len(req.Name) > user.MaxNameLength {
		writeError(w, r, domain.NewInvalid("name", "too long"))
		return
	}

	callerID := middleware.CallerID(r.Context())
	if err := h.Users.UpdateProfile(r.Context(), callerID, req.Name); err != nil {
		writeError(w, r, err)
		return
	}

	u, err := h.Users.FindByID(r.Context(), callerID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newUserProfileResponse(u))
}

// HandleListSessions returns all active sessions for the authenticated user.
// @Summary List sessions
// @Description Returns all active sessions for the authenticated user
// @Tags Users
// @Produce json
// @Security BearerAuth
// @Success 200 {array} SessionResponse
// @Failure 401 {object} ErrorBody
// @Router /users/me/sessions [get]
func (h *UserHandlers) HandleListSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := h.Sessions.ListForUser(r.Context(), middleware.CallerID(r.Context()))
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]SessionResponse, 0, len(sessions))
	for _, s := range sessions {
		resp := SessionResponse{
			ID:         string(s.ID),
			DeviceName: s.DeviceName,
			IPAddress:  s.IPAddress,
			CreatedAt:  s.CreatedAt.UTC().Format(timeFormat),
		}
		if s.LastRefreshAt != nil {
			t := s.LastRefreshAt.UTC().Format(timeFormat)
			resp.LastActiveAt = &t
		}
		out = append(out, resp)
	}
	writeJSON(w, http.StatusOK, out)
}

// HandleRevokeSession revokes a single session belonging to the caller.
// @Summary Revoke session
// @Description Revoke a specific session for the authenticated user
// @Tags Users
// @Security BearerAuth
// @Param id path string true "Session ID"
// @Success 204 "No content"
// @Failure 401 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /users/me/sessions/{id} [delete]
func (h *UserHandlers) HandleRevokeSession(w http.ResponseWriter, r *http.Request) {
	callerID := middleware.CallerID(r.Context())
	sessionID := user.SessionID(chi.URLParam(r, "id"))

	// Verify the session belongs to the caller
	sessions, err := h.Sessions.ListForUser(r.Context(), callerID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	found := false
	for _, s := range sessions {
		if s.ID == sessionID {
			found = true
			break
		}
	}
	if !found {
		writeError(w, r, domain.ErrNotFound)
		return
	}

	if err := h.Sessions.Revoke(r.Context(), sessionID); err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.SessionRevoked(r.Context(), string(callerID), string(sessionID), middleware.ClientIP(r), r.UserAgent())
	w.WriteHeader(http.StatusNoContent)
}

// HandleGetMemberPublicKey returns a user's public keys for vault sharing.
// @Summary Get member public key
// @Description Returns a member's public keys for encrypting shared vault keys
// @Tags Organizations
// @Produce json
// @Security BearerAuth
// @Param id path string true "Organization ID"
// @Param userId path string true "User ID"
// @Success 200 {object} PublicKeyResponse
// @Failure 401 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /orgs/{id}/members/{userId}/pubkey [get]
func (h *UserHandlers) HandleGetMemberPublicKey(w http.ResponseWriter, r *http.Request) {
	u, err := h.Users.FindByID(r.Context(), user.ID(chi.URLParam(r, "userId")))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, PublicKeyResponse{
		UserID:            string(u.ID),
		PublicKey:         encodeB64(u.PublicKey.Bytes()),
		IdentityPublicKey: encodeB64(u.IdentityPublicKey.Bytes()),
	})
}
