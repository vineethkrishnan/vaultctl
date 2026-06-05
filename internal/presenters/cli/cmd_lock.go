// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newLockCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "lock",
		Short: "Lock the vault (no-op for CLI single-shot processes)",
		Long: `Lock the vault by clearing any in-memory key cache.

The CLI is single-shot - each invocation derives keys, uses them, and
exits - so there is nothing persistent to wipe. This command exists for
API parity with the browser and extension clients. It succeeds silently.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if isJSON(cmd) {
				return printJSON(cmd, map[string]string{"status": "locked"})
			}
			_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Vault locked.")
			return nil
		},
	}
}
