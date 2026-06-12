// SPDX-License-Identifier: AGPL-3.0-or-later

// Package upgrade implements UpgradeExecutor backends for the in-app
// one-click upgrade feature. Each backend triggers the host-level upgrade
// mechanism (Watchtower, a shell script, etc.) and streams log lines back
// to the caller.
//
// The server itself never pulls Docker images or modifies its own binary;
// it merely calls out to something on the host that does. The executor is
// configured at startup via VAULTCTL_UPGRADE_HOOK_* env vars and is
// unavailable (disabled) when none are set.
package upgrade

import "context"

// Event is a single streamed message sent to the client during an upgrade.
type Event struct {
	// Type is one of: "log", "restarting", "error".
	Type string `json:"type"`
	// Msg is a human-readable line to display in the UI.
	Msg string `json:"msg,omitempty"`
}

// Executor runs the host-level upgrade and emits Event values on the
// returned channel. The channel is closed when the executor is done or has
// handed off to the host process manager (which will restart the server).
// Implementations must respect ctx cancellation.
type Executor interface {
	Execute(ctx context.Context) <-chan Event
}
