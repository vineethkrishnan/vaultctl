// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !darwin && !linux

package cli

import "github.com/spf13/cobra"

func newAgentCmd() *cobra.Command {
	return &cobra.Command{
		Use:    "agent",
		Short:  "Run the key agent (macOS and Linux only)",
		Hidden: true,
		RunE: func(*cobra.Command, []string) error {
			return errAgentUnsupported
		},
	}
}
