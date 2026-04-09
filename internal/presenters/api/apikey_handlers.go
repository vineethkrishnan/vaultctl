package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/vineethkrishnan/vaultctl/internal/application/auth"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// APIKeyHandlers ties HTTP to the API key use cases.
type APIKeyHandlers struct {
	Create *auth.CreateAPIKey
	List   *auth.ListAPIKeys
	Delete *auth.DeleteAPIKey
}

// HandleCreateAPIKey creates a new personal API key.
// @Summary Create API key
// @Description Generate a new personal API key for programmatic access. The raw key is returned only once.
// @Tags API Keys
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreateAPIKeyRequest true "API key creation payload"
// @Success 201 {object} CreateAPIKeyResponse
// @Failure 400 {object} ErrorBody
// @Failure 401 {object} ErrorBody
// @Router /api-keys [post]
func (h *APIKeyHandlers) HandleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	var req CreateAPIKeyRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}

	var expiresIn *time.Duration
	if req.ExpiresIn != nil {
		d, err := time.ParseDuration(*req.ExpiresIn)
		if err != nil {
			writeError(w, r, err)
			return
		}
		expiresIn = &d
	}

	out, err := h.Create.Execute(r.Context(), auth.CreateAPIKeyInput{
		Caller:    middleware.CallerID(r.Context()),
		Name:      req.Name,
		ExpiresIn: expiresIn,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	resp := CreateAPIKeyResponse{
		ID:        out.KeyID,
		Name:      out.Name,
		Key:       out.RawKey,
		KeyPrefix: out.KeyPrefix,
	}
	if out.ExpiresAt != nil {
		s := out.ExpiresAt.UTC().Format(timeFormat)
		resp.ExpiresAt = &s
	}
	writeJSON(w, http.StatusCreated, resp)
}

// HandleListAPIKeys returns all API keys for the authenticated user.
// @Summary List API keys
// @Description Returns all API keys for the authenticated user (without raw key values)
// @Tags API Keys
// @Produce json
// @Security BearerAuth
// @Success 200 {array} APIKeyResponse
// @Failure 401 {object} ErrorBody
// @Router /api-keys [get]
func (h *APIKeyHandlers) HandleListAPIKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := h.List.Execute(r.Context(), auth.ListAPIKeysInput{
		Caller: middleware.CallerID(r.Context()),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	out := make([]APIKeyResponse, 0, len(keys))
	for _, k := range keys {
		resp := APIKeyResponse{
			ID:        string(k.ID),
			Name:      k.Name,
			KeyPrefix: k.KeyPrefix,
			CreatedAt: k.CreatedAt.UTC().Format(timeFormat),
		}
		if k.LastUsedAt != nil {
			s := k.LastUsedAt.UTC().Format(timeFormat)
			resp.LastUsedAt = &s
		}
		if k.ExpiresAt != nil {
			s := k.ExpiresAt.UTC().Format(timeFormat)
			resp.ExpiresAt = &s
		}
		out = append(out, resp)
	}
	writeJSON(w, http.StatusOK, out)
}

// HandleDeleteAPIKey deletes a personal API key.
// @Summary Delete API key
// @Description Permanently delete a personal API key
// @Tags API Keys
// @Security BearerAuth
// @Param id path string true "API Key ID"
// @Success 204 "No content"
// @Failure 401 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /api-keys/{id} [delete]
func (h *APIKeyHandlers) HandleDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	err := h.Delete.Execute(r.Context(), auth.DeleteAPIKeyInput{
		Caller: middleware.CallerID(r.Context()),
		KeyID:  user.APIKeyID(chi.URLParam(r, "id")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
