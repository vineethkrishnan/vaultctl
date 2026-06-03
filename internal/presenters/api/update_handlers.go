// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/updatecheck"
)

// UpdateHandlers serves the server-side update check.
type UpdateHandlers struct {
	Enabled        bool
	CurrentVersion string
	Checker        *updatecheck.Checker
}

// UpdateStatusResponse describes whether a newer release is available.
type UpdateStatusResponse struct {
	Enabled         bool   `json:"enabled"`
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion,omitempty"`
	UpdateAvailable bool   `json:"updateAvailable"`
	Severity        string `json:"severity,omitempty"` // major | minor | patch | none
	ReleaseNotes    string `json:"releaseNotes,omitempty"`
	ReleaseURL      string `json:"releaseUrl,omitempty"`
	PublishedAt     string `json:"publishedAt,omitempty"`
}

// HandleGetUpdates returns the current vs latest release status.
// @Summary Update check
// @Description Reports the running version and, when update checking is enabled, the latest GitHub release and whether an update is available.
// @Tags System
// @Produce json
// @Security BearerAuth
// @Success 200 {object} UpdateStatusResponse
// @Router /updates [get]
func (h *UpdateHandlers) HandleGetUpdates(w http.ResponseWriter, r *http.Request) {
	resp := UpdateStatusResponse{Enabled: h.Enabled, CurrentVersion: h.CurrentVersion}
	if !h.Enabled || h.Checker == nil {
		writeJSON(w, http.StatusOK, resp)
		return
	}
	rel, err := h.Checker.Latest(r.Context())
	if err != nil {
		// A failed/offline check must not be an error to the client — just
		// report the current version with no update available.
		writeJSON(w, http.StatusOK, resp)
		return
	}
	resp.LatestVersion = rel.Version
	resp.Severity = updatecheck.Severity(h.CurrentVersion, rel.Version)
	resp.UpdateAvailable = updatecheck.UpdateAvailable(h.CurrentVersion, rel.Version)
	resp.ReleaseNotes = rel.Notes
	resp.ReleaseURL = rel.URL
	if !rel.PublishedAt.IsZero() {
		resp.PublishedAt = rel.PublishedAt.UTC().Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, resp)
}
