// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

const (
	auditDefaultLimit = 50
	auditMaxLimit     = 200
)

// AuditHandlers serves the caller's own audit trail (FEAT-2). It reads through
// the same AuditLogReader port the notification feed uses.
type AuditHandlers struct {
	Reader ports.AuditLogReader
}

// AuditEntryDTO is one audit-trail row in the self-audit response.
type AuditEntryDTO struct {
	Action       string `json:"action"`
	ResourceType string `json:"resourceType,omitempty"`
	IPAddress    string `json:"ipAddress,omitempty"`
	UserAgent    string `json:"userAgent,omitempty"`
	CreatedAt    string `json:"createdAt"`
}

// AuditListResponse is a page of audit entries plus the cursor for the next
// page. NextBefore is empty when there are no more entries.
type AuditListResponse struct {
	Entries    []AuditEntryDTO `json:"entries"`
	NextBefore string          `json:"nextBefore,omitempty"`
}

// HandleListOwnAudit returns the caller's audit entries, newest first.
// @Summary List own audit trail
// @Description Returns the authenticated user's audit entries (newest first), keyset-paginated via ?before= and ?limit=.
// @Tags Users
// @Produce json
// @Security BearerAuth
// @Param limit query int false "Max entries (1-200, default 50)"
// @Param before query string false "RFC3339 cursor; return entries strictly older than this"
// @Success 200 {object} AuditListResponse
// @Failure 400 {object} ErrorBody
// @Router /users/me/audit [get]
func (h *AuditHandlers) HandleListOwnAudit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	limit := auditDefaultLimit
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > auditMaxLimit {
			writeError(w, r, domain.NewInvalid("limit", "must be an integer between 1 and 200"))
			return
		}
		limit = n
	}

	var before time.Time
	if raw := q.Get("before"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeError(w, r, domain.NewInvalid("before", "must be an RFC3339 timestamp"))
			return
		}
		before = t
	}

	userID := string(middleware.CallerID(r.Context()))
	entries, err := h.Reader.PageForUser(r.Context(), userID, before, limit)
	if err != nil {
		writeError(w, r, err)
		return
	}

	dtos := make([]AuditEntryDTO, 0, len(entries))
	for _, e := range entries {
		dtos = append(dtos, AuditEntryDTO{
			Action:       e.Action,
			ResourceType: e.ResourceType,
			IPAddress:    e.IPAddress,
			UserAgent:    e.UserAgent,
			CreatedAt:    e.CreatedAt.UTC().Format(time.RFC3339),
		})
	}

	resp := AuditListResponse{Entries: dtos}
	if len(entries) == limit {
		resp.NextBefore = entries[len(entries)-1].CreatedAt.UTC().Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, resp)
}
