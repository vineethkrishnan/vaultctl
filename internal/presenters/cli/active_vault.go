// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"errors"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// resolveActiveVault picks the vault a command should target, using the
// precedence documented in architecture §M10:
//
//	--vault <id>      (per-command flag)    →
//	VAULTCTL_VAULT=<id> (environment)       →
//	session.ActiveVaultID (sticky, stored)  →
//	huh interactive picker (only if stdin is a TTY and multi-vault)
//
// If the session has exactly one vault, that vault is returned without
// prompting regardless of flags. Returns the matched SessionVault.
func resolveActiveVault(cmd *cobra.Command, session *Session) (SessionVault, error) {
	if len(session.Vaults) == 0 {
		return SessionVault{}, errors.New("no vaults available on this session")
	}

	// Precedence 1: explicit --vault flag.
	flagID, _ := cmd.Flags().GetString("vault")
	if flagID != "" {
		for _, v := range session.Vaults {
			if v.ID == flagID {
				return v, nil
			}
		}
		return SessionVault{}, fmt.Errorf("vault %q not found in session", flagID)
	}

	// Precedence 2: VAULTCTL_VAULT env var.
	if envID := os.Getenv(envActiveVault); envID != "" {
		for _, v := range session.Vaults {
			if v.ID == envID {
				return v, nil
			}
		}
		return SessionVault{}, fmt.Errorf("VAULTCTL_VAULT=%q not found in session", envID)
	}

	// Precedence 3: sticky choice from keychain.
	if session.ActiveVaultID != "" {
		for _, v := range session.Vaults {
			if v.ID == session.ActiveVaultID {
				return v, nil
			}
		}
	}

	// Single-vault shortcut.
	if len(session.Vaults) == 1 {
		return session.Vaults[0], nil
	}

	// Precedence 4: interactive picker.
	options := make(map[string]string, len(session.Vaults))
	for _, v := range session.Vaults {
		options[fmt.Sprintf("%s (%s)", v.Name, v.Type)] = v.ID
	}
	chosen, err := promptSelect("Select a vault", options)
	if err != nil {
		return SessionVault{}, err
	}
	for _, v := range session.Vaults {
		if v.ID == chosen {
			return v, nil
		}
	}
	return SessionVault{}, errors.New("no vault selected")
}

// addVaultFlag attaches the `--vault` flag to a command so it can opt into
// the precedence chain above.
func addVaultFlag(cmd *cobra.Command) {
	cmd.Flags().String("vault", "", "Vault ID (overrides VAULTCTL_VAULT and sticky selection)")
}
