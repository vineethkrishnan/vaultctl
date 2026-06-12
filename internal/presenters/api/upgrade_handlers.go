// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/upgrade"
)

// UpgradeHandlers serves the in-app one-click upgrade endpoint.
// The endpoint is only registered when an Executor is configured
// (VAULTCTL_UPGRADE_HOOK_URL or VAULTCTL_UPGRADE_HOOK_SCRIPT).
type UpgradeHandlers struct {
	Executor upgrade.Executor
}

// HandleApply streams the upgrade process as SSE events over the response body.
// The client uses fetch() + ReadableStream (not EventSource) because EventSource
// only supports GET. The handler is guarded by requireAdmin + requireStepUp in
// the router - no additional auth check is needed here.
//
// Event shape: {"type":"log","msg":"..."} | {"type":"restarting","msg":"..."} | {"type":"error","msg":"..."}
//
// @Summary Apply in-app upgrade
// @Description Triggers the configured upgrade hook and streams progress as newline-delimited JSON events. The server will become temporarily unreachable once the "restarting" event is sent.
// @Tags System
// @Produce text/event-stream
// @Security BearerAuth
// @Success 200
// @Failure 403 {object} ErrorBody
// @Failure 503 {object} ErrorBody "upgrade not configured"
// @Router /updates/apply [post]
func (h *UpgradeHandlers) HandleApply(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, ErrorBody{})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no") // disable Nginx buffering

	sendEvent := func(ev upgrade.Event) bool {
		b, _ := json.Marshal(ev)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	for ev := range h.Executor.Execute(r.Context()) {
		if !sendEvent(ev) {
			return
		}
		if ev.Type == "restarting" || ev.Type == "error" {
			return
		}
	}
}
