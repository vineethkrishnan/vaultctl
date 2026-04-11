// Package cli contains the vaultctl CLI command tree built with cobra.
//
// Scope delivered in M10:
//   - Root + version + help
//   - `vaultctl server` — starts the API server
//   - `vaultctl admin init` — bootstrap first admin user
//   - `vaultctl backup` — trigger a backup (delegates to M12)
//   - Stubs for login/logout/get/list/create — these need the TS crypto
//     module (M6) for actual master-password-to-authHash derivation, so
//     they're skeleton commands that document the expected UX.
package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// Version is stamped in by goreleaser's -ldflags.
var (
	Version = "dev"
	Commit  = "dev"
)

// NewRootCmd builds the full command tree.
func NewRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:           "vaultctl",
		Short:         "vaultctl — self-hosted zero-knowledge credential vault",
		SilenceUsage:  true,
		SilenceErrors: true,
		Version:       fmt.Sprintf("%s (%s)", Version, Commit),
	}

	// Global --json flag — every client command honours it via isJSON().
	root.PersistentFlags().Bool("json", false, "Emit JSON output instead of tables")

	root.AddCommand(newServerCmd(), newHealthCheckCmd(), newAdminCmd(), newBackupCmd())
	root.AddCommand(newClientCmds()...)

	return root
}

// Execute runs the root command and exits the process with the appropriate
// exit code. Exit codes come from PRD §12.2.
func Execute() {
	if err := NewRootCmd().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		// Cobra will not have already printed since SilenceErrors=true.
		os.Exit(1)
	}
}
