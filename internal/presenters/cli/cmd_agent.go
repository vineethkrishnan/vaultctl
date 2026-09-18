// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin || linux

package cli

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
)

func newAgentCmd() *cobra.Command {
	var timeout time.Duration
	cmd := &cobra.Command{
		Use:   "agent",
		Short: "Run the key agent in the foreground",
		Long: `Run the per-user key agent that keeps the vault unlocked between CLI
invocations, the way ssh-agent keeps SSH keys loaded.

The agent holds only the 32-byte stretched key, in memory, and forgets it
after --timeout of inactivity, on ` + "`vaultctl lock`" + `, or when it exits.
It listens on a 0600 unix socket under $XDG_RUNTIME_DIR (or the user cache
dir) and refuses connections from other users.

` + "`vaultctl unlock`" + ` starts the agent automatically, so this command is only
needed to run it under a supervisor or to pick a different timeout.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			socketPath, err := agentSocketPath()
			if err != nil {
				return err
			}
			_, _ = fmt.Fprintf(cmd.ErrOrStderr(), "vaultctl agent listening on %s (idle timeout %s)\n", socketPath, timeout)
			return runAgent(cmd.Context(), socketPath, timeout)
		},
	}
	cmd.Flags().DurationVar(&timeout, "timeout", defaultAgentTimeout, "Forget the key after this much inactivity")
	return cmd
}
