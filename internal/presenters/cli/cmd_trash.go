// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"errors"
	"fmt"
	"sort"

	"github.com/spf13/cobra"
)

func newTrashCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "trash",
		Short: "Manage trashed (soft-deleted) items",
	}
	cmd.AddCommand(
		newTrashListCmd(),
		newTrashRestoreCmd(),
		newTrashPurgeCmd(),
	)
	addVaultFlag(cmd)
	return cmd
}

func newTrashListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List trashed items",
		RunE: func(cmd *cobra.Command, _ []string) error {
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

			raw, err := httpGet("/vaults/"+vaultMeta.ID+"/trash", session)
			if err != nil {
				return err
			}
			var items []apiItem
			if err := unmarshalJSON(raw, &items); err != nil {
				return err
			}

			type entry struct {
				ID   string `json:"id"`
				Name string `json:"name"`
				Type string `json:"type"`
			}
			decoded := make([]entry, 0, len(items))
			for _, it := range items {
				name, err := decryptItemName(vaultKey, it.EncryptedName)
				if err != nil {
					name = "<unreadable>"
				}
				decoded = append(decoded, entry{ID: it.ID, Name: name, Type: it.ItemType})
			}
			sort.Slice(decoded, func(i, j int) bool { return decoded[i].Name < decoded[j].Name })

			if isJSON(cmd) {
				return printJSON(cmd, decoded)
			}
			if len(decoded) == 0 {
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Trash is empty.")
				return nil
			}
			rows := make([][]string, 0, len(decoded))
			for _, d := range decoded {
				rows = append(rows, []string{d.Name, d.Type, d.ID})
			}
			return printTable(cmd, []string{"NAME", "TYPE", "ID"}, rows)
		},
	}
}

func newTrashRestoreCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "restore <name>",
		Short: "Restore a trashed item",
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

			raw, err := httpGet("/vaults/"+vaultMeta.ID+"/trash", session)
			if err != nil {
				return err
			}
			var items []apiItem
			if err := unmarshalJSON(raw, &items); err != nil {
				return err
			}
			match, err := findItemByName(items, vaultKey, args[0])
			if err != nil {
				return fmt.Errorf("item %q not found in trash", args[0])
			}

			if _, err := httpPost("/vaults/"+vaultMeta.ID+"/trash/"+match.ID+"/restore", nil, session); err != nil {
				return err
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]string{"status": "restored", "id": match.ID})
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Restored %s\n", args[0])
			return nil
		},
	}
}

func newTrashPurgeCmd() *cobra.Command {
	var all bool
	cmd := &cobra.Command{
		Use:   "purge [name]",
		Short: "Permanently delete a trashed item (or all with --all)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !all && len(args) == 0 {
				return errors.New("specify an item name or use --all")
			}

			session, err := LoadSession()
			if err != nil {
				return err
			}
			vaultMeta, err := resolveActiveVault(cmd, session)
			if err != nil {
				return err
			}

			// Purge all expired trash
			if all {
				ok, err := promptConfirm("Permanently delete ALL trashed items?")
				if err != nil {
					return err
				}
				if !ok {
					return errors.New("cancelled")
				}
				raw, err := httpDelete("/vaults/"+vaultMeta.ID+"/trash", nil, session)
				if err != nil {
					return err
				}
				if isJSON(cmd) {
					// Pass through the server response
					var resp map[string]any
					if uerr := unmarshalJSON(raw, &resp); uerr == nil {
						return printJSON(cmd, resp)
					}
					return printJSON(cmd, map[string]string{"status": "purged"})
				}
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Trash purged.")
				return nil
			}

			// Purge a single item by name
			keys, err := deriveSessionKeys(session)
			if err != nil {
				return err
			}
			defer keys.Zero()

			vaultKey, ok := keys.VaultKeys[vaultMeta.ID]
			if !ok {
				return ErrLocked
			}

			raw, err := httpGet("/vaults/"+vaultMeta.ID+"/trash", session)
			if err != nil {
				return err
			}
			var items []apiItem
			if err := unmarshalJSON(raw, &items); err != nil {
				return err
			}
			match, err := findItemByName(items, vaultKey, args[0])
			if err != nil {
				return fmt.Errorf("item %q not found in trash", args[0])
			}

			confirmed, err := promptConfirm(fmt.Sprintf("Permanently delete %q?", args[0]))
			if err != nil {
				return err
			}
			if !confirmed {
				return errors.New("cancelled")
			}

			if _, err := httpDelete("/vaults/"+vaultMeta.ID+"/trash/"+match.ID, nil, session); err != nil {
				return err
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]string{"status": "purged", "id": match.ID})
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Permanently deleted %s\n", args[0])
			return nil
		},
	}
	cmd.Flags().BoolVar(&all, "all", false, "Purge all trashed items")
	return cmd
}
