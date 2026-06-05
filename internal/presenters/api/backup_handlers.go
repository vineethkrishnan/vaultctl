// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/vineethkrishnan/vaultctl/internal/application/audit"
	appbackup "github.com/vineethkrishnan/vaultctl/internal/application/backup"
	dombackup "github.com/vineethkrishnan/vaultctl/internal/domain/backup"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// BackupHandlers ties HTTP to the per-user backup destination use cases.
type BackupHandlers struct {
	Configure     *appbackup.ConfigureDestination
	List          *appbackup.ListDestinations
	Delete        *appbackup.DeleteDestination
	Run           *appbackup.RunBackup
	ListRuns      *appbackup.ListRuns
	ListArtifacts *appbackup.ListArtifacts
	Restore       *appbackup.Restore

	// Available is the set of providers this server can use (local always;
	// cloud providers only when their OAuth credentials are configured).
	Available []string

	Audit *audit.Writer
}

// ===========================================================================
// Wire types - Settings are write-only and never echoed back (they carry
// provider credentials sealed at rest).
// ===========================================================================

type configureBackupRequest struct {
	Provider      string            `json:"provider"`
	Label         string            `json:"label"`
	Settings      map[string]string `json:"settings"`
	Frequency     string            `json:"frequency"`
	RetentionKeep int               `json:"retentionKeep"`
	Enabled       bool              `json:"enabled"`
}

type destinationResponse struct {
	ID            string  `json:"id"`
	Provider      string  `json:"provider"`
	Label         string  `json:"label"`
	Frequency     string  `json:"frequency"`
	RetentionKeep int     `json:"retentionKeep"`
	Enabled       bool    `json:"enabled"`
	LastRunAt     *string `json:"lastRunAt,omitempty"`
	LastStatus    string  `json:"lastStatus,omitempty"`
	NextRunAt     *string `json:"nextRunAt,omitempty"`
	CreatedAt     string  `json:"createdAt"`
}

type runResponse struct {
	ID           string  `json:"id"`
	Status       string  `json:"status"`
	Trigger      string  `json:"trigger"`
	ArtifactName string  `json:"artifactName,omitempty"`
	SizeBytes    int64   `json:"sizeBytes"`
	Error        string  `json:"error,omitempty"`
	StartedAt    string  `json:"startedAt"`
	FinishedAt   *string `json:"finishedAt,omitempty"`
}

type artifactResponse struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

func tsPtr(t *time.Time) *string {
	if t == nil || t.IsZero() {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

func toDestinationResponse(d dombackup.Destination) destinationResponse {
	return destinationResponse{
		ID:            d.ID,
		Provider:      string(d.Provider),
		Label:         d.Label,
		Frequency:     string(d.Frequency),
		RetentionKeep: d.RetentionKeep,
		Enabled:       d.Enabled,
		LastRunAt:     tsPtr(d.LastRunAt),
		LastStatus:    string(d.LastStatus),
		NextRunAt:     tsPtr(d.NextRunAt),
		CreatedAt:     d.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func toRunResponse(r dombackup.Run) runResponse {
	return runResponse{
		ID:           r.ID,
		Status:       string(r.Status),
		Trigger:      string(r.Trigger),
		ArtifactName: r.ArtifactName,
		SizeBytes:    r.SizeBytes,
		Error:        r.Error,
		StartedAt:    r.StartedAt.UTC().Format(time.RFC3339),
		FinishedAt:   tsPtr(r.FinishedAt),
	}
}

// HandleProviders lists the providers this server supports.
func (h *BackupHandlers) HandleProviders(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"providers": h.Available})
}

// HandleList returns the caller's backup destinations.
func (h *BackupHandlers) HandleList(w http.ResponseWriter, r *http.Request) {
	caller := middleware.CallerID(r.Context())
	dests, err := h.List.Execute(r.Context(), string(caller))
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]destinationResponse, 0, len(dests))
	for _, d := range dests {
		out = append(out, toDestinationResponse(d))
	}
	writeJSON(w, http.StatusOK, map[string]any{"destinations": out})
}

// HandleConfigure creates (POST) or updates (PUT) a backup destination.
func (h *BackupHandlers) HandleConfigure(w http.ResponseWriter, r *http.Request) {
	caller := middleware.CallerID(r.Context())
	var req configureBackupRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	id := chi.URLParam(r, "id") // empty on POST
	dest, err := h.Configure.Execute(r.Context(), appbackup.ConfigureDestinationInput{
		Caller:        string(caller),
		ID:            id,
		Provider:      req.Provider,
		Label:         req.Label,
		Settings:      req.Settings,
		Frequency:     req.Frequency,
		RetentionKeep: req.RetentionKeep,
		Enabled:       req.Enabled,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.BackupConfigured(r.Context(), string(caller), dest.ID, middleware.ClientIP(r), r.UserAgent())
	status := http.StatusOK
	if id == "" {
		status = http.StatusCreated
	}
	writeJSON(w, status, toDestinationResponse(dest))
}

// HandleDelete removes a backup destination.
func (h *BackupHandlers) HandleDelete(w http.ResponseWriter, r *http.Request) {
	caller := middleware.CallerID(r.Context())
	id := chi.URLParam(r, "id")
	if err := h.Delete.Execute(r.Context(), string(caller), id); err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.BackupRemoved(r.Context(), string(caller), id, middleware.ClientIP(r), r.UserAgent())
	w.WriteHeader(http.StatusNoContent)
}

// HandleRunNow triggers a manual backup. A failed run is still recorded and
// returned with status "failed" so the UI can show why.
func (h *BackupHandlers) HandleRunNow(w http.ResponseWriter, r *http.Request) {
	caller := middleware.CallerID(r.Context())
	id := chi.URLParam(r, "id")
	run, err := h.Run.Execute(r.Context(), appbackup.RunBackupInput{
		Caller:        string(caller),
		DestinationID: id,
		Trigger:       dombackup.TriggerManual,
	})
	if err != nil && run.ID == "" {
		// Not found / ownership / record failure - no run was created.
		writeError(w, r, err)
		return
	}
	if run.Status == dombackup.StatusSuccess {
		h.Audit.BackupRun(r.Context(), string(caller), middleware.ClientIP(r), r.UserAgent())
	}
	writeJSON(w, http.StatusOK, toRunResponse(run))
}

// HandleListRuns returns recent runs for a destination.
func (h *BackupHandlers) HandleListRuns(w http.ResponseWriter, r *http.Request) {
	caller := middleware.CallerID(r.Context())
	id := chi.URLParam(r, "id")
	runs, err := h.ListRuns.Execute(r.Context(), appbackup.ListRunsInput{
		Caller:        string(caller),
		DestinationID: id,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]runResponse, 0, len(runs))
	for _, run := range runs {
		out = append(out, toRunResponse(run))
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": out})
}

// HandleListArtifacts lists the stored artifacts at a destination so the user
// can pick one to restore.
func (h *BackupHandlers) HandleListArtifacts(w http.ResponseWriter, r *http.Request) {
	caller := middleware.CallerID(r.Context())
	id := chi.URLParam(r, "id")
	objects, err := h.ListArtifacts.Execute(r.Context(), string(caller), id)
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]artifactResponse, 0, len(objects))
	for _, obj := range objects {
		out = append(out, artifactResponse{
			Name:    obj.Name,
			Size:    obj.Size,
			ModTime: obj.ModTime.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"artifacts": out})
}

// HandleRestore returns the client-encrypted export payload for an artifact.
// The client decrypts and re-imports it with the master password.
func (h *BackupHandlers) HandleRestore(w http.ResponseWriter, r *http.Request) {
	caller := middleware.CallerID(r.Context())
	id := chi.URLParam(r, "id")
	name := r.URL.Query().Get("name")
	payload, err := h.Restore.Execute(r.Context(), appbackup.RestoreInput{
		Caller:        string(caller),
		DestinationID: id,
		ArtifactName:  name,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.BackupRestored(r.Context(), string(caller), id, middleware.ClientIP(r), r.UserAgent())
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}
