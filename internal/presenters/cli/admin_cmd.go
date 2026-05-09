// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"github.com/spf13/cobra"
)

func newAdminCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "admin",
		Short: "Administrative commands (server-side)",
	}
	cmd.AddCommand(newAdminInitCmd())
	return cmd
}

func newAdminInitCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "init",
		Short: "Bootstrap the first admin user (invite-only mode)",
		Long: `Creates the first admin user when registration is set to invite-only.

The actual master-password + identity keypair generation lives in the web
client (see PRD §5.14). This command only opens a one-time registration
window so the web client can POST /auth/register with an admin role.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cmd.Println("admin init — see docs/operations/admin-bootstrap.md")
			cmd.Println("This writes a one-time registration token to the database.")
			cmd.Println("Implementation depends on M8 org flow — skeleton only in M10.")
			return nil
		},
	}
}
