// SPDX-License-Identifier: AGPL-3.0-or-later

package upgrade

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
)

// ScriptExecutor runs a shell script and streams its stdout/stderr as log
// events. The script is responsible for pulling, migrating, and restarting
// the service. It is executed with the same environment as the server process.
//
// The script path is operator-supplied via VAULTCTL_UPGRADE_HOOK_SCRIPT and
// must be an absolute path to an existing executable. It is NOT shell-expanded
// (no glob, no pipe injection - it is passed directly to exec.CommandContext).
type ScriptExecutor struct {
	// ScriptPath is the absolute path to the upgrade script.
	ScriptPath string
}

// Execute runs the script, emitting each output line as a "log" event.
// A final "restarting" event is sent when the script exits successfully
// (the script is expected to restart the service itself, making the server
// become temporarily unreachable).
func (e *ScriptExecutor) Execute(ctx context.Context) <-chan Event {
	ch := make(chan Event, 64)
	go func() {
		defer close(ch)

		ch <- Event{Type: "log", Msg: fmt.Sprintf("Running upgrade script: %s", e.ScriptPath)}

		cmd := exec.CommandContext(ctx, e.ScriptPath) //nolint:gosec // path is operator-configured, not user-supplied
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			ch <- Event{Type: "error", Msg: fmt.Sprintf("pipe: %v", err)}
			return
		}
		cmd.Stderr = cmd.Stdout // merge stderr into same pipe

		if err := cmd.Start(); err != nil {
			ch <- Event{Type: "error", Msg: fmt.Sprintf("start script: %v", err)}
			return
		}

		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			ch <- Event{Type: "log", Msg: scanner.Text()}
		}

		if err := cmd.Wait(); err != nil {
			ch <- Event{Type: "error", Msg: fmt.Sprintf("script exited with error: %v", err)}
			return
		}

		ch <- Event{Type: "restarting", Msg: "Script completed. Server is restarting."}
	}()
	return ch
}
