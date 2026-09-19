// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"errors"
	"fmt"
	"time"

	"github.com/spf13/cobra"
)

func newUnlockCmd() *cobra.Command {
	var timeout time.Duration
	cmd := &cobra.Command{
		Use:   "unlock",
		Short: "Unlock the vault and keep it unlocked in the agent",
		Long: `Prompt for the master password, verify it against the cached encrypted
private key, and hand the derived key to the vaultctl agent (started on
demand) so later commands and ` + "`vaultctl run`" + ` do not prompt again.

The key is forgotten after --timeout of inactivity or on ` + "`vaultctl lock`" + `.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			session, err := LoadSession()
			if errors.Is(err, ErrNoSession) {
				return ErrNoSession
			}
			if err != nil {
				return err
			}
			if session.APIKey != "" {
				return errors.New("cannot unlock: running in VAULTCTL_API_KEY mode")
			}
			stretchedKey, err := promptStretchedKey(session)
			if err != nil {
				return err
			}
			defer zeroBytes(stretchedKey)
			keys, err := unlockKeys(session, stretchedKey)
			if err != nil {
				return err
			}
			keys.Zero()

			expiresAt, err := agentStoreKey(stretchedKey, timeout)
			if err != nil {
				return err
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]any{jsonKeyStatus: "unlocked", "expiresAt": expiresAt})
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Vault unlocked until %s of inactivity.\n", timeout)
			return nil
		},
	}
	cmd.Flags().DurationVar(&timeout, "timeout", defaultAgentTimeout, "Lock again after this much inactivity")
	return cmd
}
