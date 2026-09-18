// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !darwin && !linux

package cli

import (
	"errors"

	"github.com/spf13/cobra"
)

func newRunCmd() *cobra.Command {
	return &cobra.Command{
		Use:    "run -- <command> [args...]",
		Short:  "Run a command and answer its login prompts (macOS and Linux only)",
		Hidden: true,
		RunE: func(*cobra.Command, []string) error {
			return errors.New("vaultctl run is only available on macOS and Linux")
		},
	}
}
