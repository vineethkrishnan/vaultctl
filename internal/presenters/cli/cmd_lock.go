// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newLockCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "lock",
		Short: "Lock the vault (wipe the key held by the agent)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if err := agentLock(); err != nil {
				return err
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]string{jsonKeyStatus: "locked"})
			}
			_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Vault locked.")
			return nil
		},
	}
}
