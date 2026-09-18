// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

const (
	envRunPrograms     = "VAULTCTL_RUN_PROGRAMS"
	defaultRunPrograms = "tsh mysql mariadb ssh psql"
)

func newShellInitCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "shell-init <zsh|bash|fish>",
		Short: "Print shell aliases that route login commands through `vaultctl run`",
		Long: `Print alias definitions so the usual login commands go through
` + "`vaultctl run`" + ` without typing the prefix. Add one line to your shell rc:

  eval "$(vaultctl shell-init zsh)"        # ~/.zshrc or ~/.bashrc
  vaultctl shell-init fish | source        # ~/.config/fish/config.fish

The programs come from VAULTCTL_RUN_PROGRAMS (space separated) and default
to "` + defaultRunPrograms + `". The aliases resolve the real binary through
PATH, so they never recurse.`,
		Args:      cobra.ExactArgs(1),
		ValidArgs: []string{"zsh", "bash", "fish"},
		RunE: func(cmd *cobra.Command, args []string) error {
			programs := strings.Fields(os.Getenv(envRunPrograms))
			if len(programs) == 0 {
				programs = strings.Fields(defaultRunPrograms)
			}
			out := cmd.OutOrStdout()
			for _, program := range programs {
				switch args[0] {
				case "zsh", "bash":
					_, _ = fmt.Fprintf(out, "alias %s='vaultctl run -- %s'\n", program, program)
				case "fish":
					_, _ = fmt.Fprintf(out, "alias %s 'vaultctl run -- %s'\n", program, program)
				default:
					return fmt.Errorf("unsupported shell %q (zsh, bash, fish)", args[0])
				}
			}
			return nil
		},
	}
}
