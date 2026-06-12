// SPDX-License-Identifier: AGPL-3.0-or-later

package upgrade

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

// WebhookExecutor triggers an HTTP endpoint (e.g. Watchtower's
// POST /v1/update) and then signals the client that the server is restarting.
// The actual image pull and container restart happen in the external service;
// the server just pokes it and waits.
type WebhookExecutor struct {
	// URL is the full endpoint to POST to (e.g. http://watchtower:8080/v1/update).
	URL string
	// Token is sent as "Authorization: Bearer <Token>" when non-empty.
	Token  string
	Client *http.Client
}

func (e *WebhookExecutor) client() *http.Client {
	if e.Client != nil {
		return e.Client
	}
	return &http.Client{Timeout: 30 * time.Second}
}

// Execute calls the hook and streams progress events.
func (e *WebhookExecutor) Execute(ctx context.Context) <-chan Event {
	ch := make(chan Event, 8)
	go func() {
		defer close(ch)

		ch <- Event{Type: "log", Msg: "Triggering upgrade hook..."}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.URL, nil)
		if err != nil {
			ch <- Event{Type: "error", Msg: fmt.Sprintf("build request: %v", err)}
			return
		}
		if e.Token != "" {
			req.Header.Set("Authorization", "Bearer "+e.Token)
		}

		resp, err := e.client().Do(req)
		if err != nil {
			ch <- Event{Type: "error", Msg: fmt.Sprintf("hook call failed: %v", err)}
			return
		}
		_ = resp.Body.Close()

		if resp.StatusCode >= 400 {
			ch <- Event{Type: "error", Msg: fmt.Sprintf("hook returned HTTP %d", resp.StatusCode)}
			return
		}

		ch <- Event{Type: "log", Msg: "Upgrade triggered. Pulling new image and running migrations..."}
		ch <- Event{Type: "restarting", Msg: "Server is restarting. The page will reconnect automatically."}
	}()
	return ch
}
