// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"fmt"
	"os"
	"strconv"

	"github.com/spf13/cobra"
)

func newConfigCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Show or change the saved CLI configuration",
		Long: `The config file remembers the server so no environment variable is
needed. Keys:

  server                 Base URL of the vaultctl server (also set by login --server)
  insecure-skip-verify   true/false; skip TLS verification. Unset means
                         "only for localhost".

VAULTCTL_SERVER and VAULTCTL_INSECURE_SKIP_VERIFY override the file when set.`,
	}
	cmd.AddCommand(newConfigShowCmd(), newConfigSetCmd(), newConfigUnsetCmd())
	return cmd
}

func newConfigShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "show",
		Short: "Print the effective configuration and where it comes from",
		RunE: func(cmd *cobra.Command, _ []string) error {
			path, err := configPath()
			if err != nil {
				return err
			}
			config := loadConfig()
			if isJSON(cmd) {
				return printJSON(cmd, map[string]any{
					"path":               path,
					configKeyServer:      ServerURL(),
					"insecureSkipVerify": insecureSkipVerify(),
					"file":               config,
				})
			}
			out := cmd.OutOrStdout()
			_, _ = fmt.Fprintf(out, "Config file:            %s\n", path)
			_, _ = fmt.Fprintf(out, "Server:                 %s%s\n", ServerURL(), sourceNote(envServer, config.Server))
			_, _ = fmt.Fprintf(out, "Insecure skip verify:   %v%s\n", insecureSkipVerify(), insecureSource(config))
			return nil
		},
	}
}

func newConfigSetCmd() *cobra.Command {
	return &cobra.Command{
		Use:       "set <key> <value>",
		Short:     "Save a configuration value",
		Args:      cobra.ExactArgs(2),
		ValidArgs: []string{configKeyServer, configKeyInsecure},
		RunE: func(cmd *cobra.Command, args []string) error {
			config := loadConfig()
			switch args[0] {
			case configKeyServer:
				normalized, err := normalizeServerURL(args[1])
				if err != nil {
					return err
				}
				config.Server = normalized
			case configKeyInsecure:
				value, err := strconv.ParseBool(args[1])
				if err != nil {
					return fmt.Errorf("%s expects true or false", configKeyInsecure)
				}
				config.InsecureSkipVerify = &value
			default:
				return fmt.Errorf("unknown key %q (valid: %s, %s)", args[0], configKeyServer, configKeyInsecure)
			}
			if err := saveConfig(config); err != nil {
				return err
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]string{jsonKeyStatus: "saved", "key": args[0]})
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Saved %s.\n", args[0])
			return nil
		},
	}
}

func newConfigUnsetCmd() *cobra.Command {
	return &cobra.Command{
		Use:       "unset <key>",
		Short:     "Remove a configuration value",
		Args:      cobra.ExactArgs(1),
		ValidArgs: []string{configKeyServer, configKeyInsecure},
		RunE: func(cmd *cobra.Command, args []string) error {
			config := loadConfig()
			switch args[0] {
			case configKeyServer:
				config.Server = ""
			case configKeyInsecure:
				config.InsecureSkipVerify = nil
			default:
				return fmt.Errorf("unknown key %q (valid: %s, %s)", args[0], configKeyServer, configKeyInsecure)
			}
			if err := saveConfig(config); err != nil {
				return err
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]string{jsonKeyStatus: "removed", "key": args[0]})
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Removed %s.\n", args[0])
			return nil
		},
	}
}

func sourceNote(envName, fileValue string) string {
	switch {
	case os.Getenv(envName) != "":
		return "  (from " + envName + ")"
	case fileValue != "":
		return "  (from config file)"
	default:
		return "  (default)"
	}
}

func insecureSource(config Config) string {
	switch {
	case os.Getenv(envInsecureSkipVerify) != "":
		return "  (from " + envInsecureSkipVerify + ")"
	case config.InsecureSkipVerify != nil:
		return "  (from config file)"
	default:
		return "  (default: only for localhost)"
	}
}
