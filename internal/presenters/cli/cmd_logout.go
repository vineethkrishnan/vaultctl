// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"
)

func newLogoutCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "logout",
		Short: "End the current session and clear the keychain entry",
		RunE: func(cmd *cobra.Command, _ []string) error {
			session, err := LoadSession()
			if errors.Is(err, ErrNoSession) {
				if isJSON(cmd) {
					return printJSON(cmd, map[string]string{"status": "already-logged-out"})
				}
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), "No active session.")
				return nil
			}
			if err != nil {
				return err
			}
			if session.APIKey != "" {
				// API-key mode: nothing to revoke on the server, nothing
				// to wipe in the keychain.
				if isJSON(cmd) {
					return printJSON(cmd, map[string]string{"status": "api-key-mode"})
				}
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), "API-key mode - no session to revoke.")
				return nil
			}

			// Best-effort server revocation - never block logout on a
			// server error because the operator's goal is "get me out".
			if session.RefreshToken != "" {
				if _, err := httpPost("/auth/logout", map[string]string{"refreshToken": session.RefreshToken}, session); err != nil {
					printErr("warning: server logout failed: " + err.Error())
				}
			}
			if err := ClearSession(); err != nil {
				return err
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]string{"status": "ok"})
			}
			_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Logged out.")
			return nil
		},
	}
}
