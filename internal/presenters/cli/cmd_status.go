// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"
)

func newStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show current session status",
		RunE: func(cmd *cobra.Command, _ []string) error {
			session, err := LoadSession()
			if errors.Is(err, ErrNoSession) {
				if isJSON(cmd) {
					return printJSON(cmd, map[string]any{"authenticated": false})
				}
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Not logged in.")
				return nil
			}
			if err != nil {
				return err
			}
			if session.APIKey != "" {
				if isJSON(cmd) {
					return printJSON(cmd, map[string]any{
						"authenticated": true, "mode": "api-key", "server": ServerURL(),
					})
				}
				_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Authenticated via VAULTCTL_API_KEY → %s\n", ServerURL())
				return nil
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]any{
					"authenticated":    true,
					"mode":             "master-password",
					"userId":           session.UserID,
					"email":            session.Email,
					"role":             session.Role,
					"server":           ServerURL(),
					"vaultCount":       len(session.Vaults),
					"activeVaultId":    session.ActiveVaultID,
					"refreshExpiresAt": session.RefreshExpiresAt,
				})
			}
			out := cmd.OutOrStdout()
			_, _ = fmt.Fprintf(out, "Authenticated as %s (%s)\n", session.Email, session.Role)
			_, _ = fmt.Fprintf(out, "Server: %s\n", ServerURL())
			_, _ = fmt.Fprintf(out, "Vaults: %d\n", len(session.Vaults))
			if session.ActiveVaultID != "" {
				_, _ = fmt.Fprintf(out, "Active vault: %s\n", session.ActiveVaultID)
			}
			return nil
		},
	}
}
