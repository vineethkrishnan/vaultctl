// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"
)

func newGetCmd() *cobra.Command {
	var field string
	cmd := &cobra.Command{
		Use:   "get <name>",
		Short: "Fetch and decrypt an item by name",
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
			data, err := decryptItemData(vaultKey, match.EncryptedData)
			if err != nil {
				return err
			}

			if isJSON(cmd) {
				return printJSON(cmd, map[string]any{
					"id":   match.ID,
					"type": match.ItemType,
					"name": args[0],
					"data": data,
				})
			}

			// Field-scoped output — ideal for scripting (pipe into `xclip`).
			if field != "" {
				value, err := pickField(data, field)
				if err != nil {
					return err
				}
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), value)
				return nil
			}
			// Full human view.
			out := cmd.OutOrStdout()
			_, _ = fmt.Fprintf(out, "Name:     %s\n", args[0])
			_, _ = fmt.Fprintf(out, "Type:     %s\n", match.ItemType)
			if data.Username != "" {
				_, _ = fmt.Fprintf(out, "Username: %s\n", data.Username)
			}
			if data.Password != "" {
				_, _ = fmt.Fprintf(out, "Password: %s\n", data.Password)
			}
			if data.URI != "" {
				_, _ = fmt.Fprintf(out, "URI:      %s\n", data.URI)
			}
			if data.TOTP != "" {
				_, _ = fmt.Fprintln(out, "TOTP:     (use `vaultctl totp` to generate a code)")
			}
			if data.Notes != "" {
				_, _ = fmt.Fprintf(out, "Notes:    %s\n", data.Notes)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&field, "field", "", "Output a single field (password, username, totp, uri, notes)")
	addVaultFlag(cmd)
	return cmd
}

// pickField extracts one field by name — used by `--field`.
func pickField(data ItemData, name string) (string, error) {
	switch name {
	case "password":
		return data.Password, nil
	case "username":
		return data.Username, nil
	case "totp":
		return data.TOTP, nil
	case "uri":
		return data.URI, nil
	case "notes":
		return data.Notes, nil
	default:
		return "", errors.New("unknown field (valid: password, username, totp, uri, notes)")
	}
}
