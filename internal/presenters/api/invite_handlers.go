package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/vineethkrishnan/vaultctl/internal/application/auth"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// InviteHandlers ties HTTP to the invite use cases.
type InviteHandlers struct {
	CreateInvite *auth.CreateInvite
	RedeemInvite *auth.RedeemInvite
	RevokeInvite *auth.RevokeInvite
	ListInvites  *auth.ListInvites
}

// HandleCreateInvite issues a new org invite.
// @Summary Create invite
// @Description Admin creates an invite token for a new member
// @Tags Invites
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreateInviteRequest true "Invite payload"
// @Success 201 {object} CreateInviteResponse
// @Failure 400 {object} ErrorBody
// @Failure 401 {object} ErrorBody
// @Failure 403 {object} ErrorBody
// @Router /invites [post]
func (h *InviteHandlers) HandleCreateInvite(w http.ResponseWriter, r *http.Request) {
	var req CreateInviteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}

	role, err := user.ParseRole(req.Role)
	if err != nil {
		writeError(w, r, err)
		return
	}

	expiresIn, err := time.ParseDuration(req.ExpiresIn)
	if err != nil {
		writeError(w, r, err)
		return
	}

	// TODO: resolve caller's org from membership; for now accept a
	// hardcoded single-org model where the org_id is derived upstream.
	// The admin's org is carried in their claims or looked up from their
	// membership. For the initial implementation we use a placeholder
	// that the caller's admin-middleware has already validated.
	callerID := middleware.CallerID(r.Context())
	orgID := r.URL.Query().Get("orgId")
	if orgID == "" {
		writeError(w, r, &domain.Invalid{Field: "orgId", Message: "required"})
		return
	}

	out, err := h.CreateInvite.Execute(r.Context(), auth.CreateInviteInput{
		Caller:    callerID,
		OrgID:     organization.ID(orgID),
		Email:     req.Email,
		Role:      role,
		ExpiresIn: expiresIn,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusCreated, CreateInviteResponse{
		InviteID: out.InviteID,
		Token:    out.Token,
	})
}

// HandleRedeemInvite validates and marks an invite as used.
// @Summary Redeem invite
// @Description New user redeems an invite token during registration
// @Tags Invites
// @Accept json
// @Produce json
// @Param body body RedeemInviteRequest true "Raw invite token"
// @Success 200 {object} RedeemInviteResponse
// @Failure 400 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /invites/redeem [post]
func (h *InviteHandlers) HandleRedeemInvite(w http.ResponseWriter, r *http.Request) {
	var req RedeemInviteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}

	out, err := h.RedeemInvite.Execute(r.Context(), auth.RedeemInviteInput{
		Token: req.Token,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, RedeemInviteResponse{
		OrgID: out.OrgID,
		Email: out.Email,
		Role:  string(out.Role),
	})
}

// HandleRevokeInvite cancels a pending invite.
// @Summary Revoke invite
// @Description Admin revokes a pending invite by ID
// @Tags Invites
// @Security BearerAuth
// @Param id path string true "Invite ID"
// @Success 204 "No content"
// @Failure 401 {object} ErrorBody
// @Failure 403 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /invites/{id} [delete]
func (h *InviteHandlers) HandleRevokeInvite(w http.ResponseWriter, r *http.Request) {
	inviteID := chi.URLParam(r, "id")
	callerID := middleware.CallerID(r.Context())

	err := h.RevokeInvite.Execute(r.Context(), auth.RevokeInviteInput{
		Caller:   callerID,
		InviteID: inviteID,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// HandleListInvites returns pending invites for the caller's org.
// @Summary List invites
// @Description Admin lists pending invites for an organization
// @Tags Invites
// @Produce json
// @Security BearerAuth
// @Param orgId query string true "Organization ID"
// @Success 200 {array} InviteResponse
// @Failure 401 {object} ErrorBody
// @Failure 403 {object} ErrorBody
// @Router /invites [get]
func (h *InviteHandlers) HandleListInvites(w http.ResponseWriter, r *http.Request) {
	callerID := middleware.CallerID(r.Context())
	rawOrgID := r.URL.Query().Get("orgId")
	if rawOrgID == "" {
		writeError(w, r, &domain.Invalid{Field: "orgId", Message: "required"})
		return
	}
	orgID := organization.ID(rawOrgID)

	invites, err := h.ListInvites.Execute(r.Context(), auth.ListInvitesInput{
		Caller: callerID,
		OrgID:  orgID,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	dtos := make([]InviteResponse, 0, len(invites))
	for _, inv := range invites {
		dtos = append(dtos, InviteResponse{
			ID:        string(inv.ID),
			Email:     inv.Email.String(),
			Role:      string(inv.Role),
			InviterID: string(inv.InvitedBy),
			ExpiresAt: inv.ExpiresAt.UTC().Format(timeFormat),
			CreatedAt: inv.CreatedAt.UTC().Format(timeFormat),
		})
	}

	writeJSON(w, http.StatusOK, dtos)
}
