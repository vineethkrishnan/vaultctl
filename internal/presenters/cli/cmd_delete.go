// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"
)

func newDeleteCmd() *cobra.Command {
	var force bool
	cmd := &cobra.Command{
		Use:   "delete <name>",
		Short: "Soft-delete (trash) an item",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			session, err := LoadSession()
			if err != nil {
				return err
			}
			vaultMeta, err := resolveActiveVault(cmd, session)
			if err != nil {
				return err
			}
			keys, err := deriveSessionKeys(session)
			if err != nil {
				return err
			}
			defer keys.Zero()
			vaultKey, ok := keys.VaultKeys[vaultMeta.ID]
			if !ok {
				return ErrLocked
			}

			raw, err := httpGet("/vaults/"+vaultMeta.ID+"/items", session)
			if err != nil {
				return err
			}
			var items []apiItem
			if err := unmarshalJSON(raw, &items); err != nil {
				return err
			}
			match, err := findItemByName(items, vaultKey, args[0])
			if err != nil {
				return err
			}

			if !force {
				ok, err := promptConfirm(fmt.Sprintf("Move %q to trash?", args[0]))
				if err != nil {
					return err
				}
				if !ok {
					return errors.New("cancelled")
				}
			}
			if _, err := httpDelete("/vaults/"+vaultMeta.ID+"/items/"+match.ID, nil, session); err != nil {
				return err
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]string{"status": "trashed", "id": match.ID})
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Trashed %s\n", args[0])
			return nil
		},
	}
	cmd.Flags().BoolVar(&force, "force", false, "Skip confirmation prompt")
	addVaultFlag(cmd)
	return cmd
}
