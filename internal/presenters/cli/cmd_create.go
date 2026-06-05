// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"
)

func newCreateCmd() *cobra.Command {
	var (
		name      string
		itemType  string
		username  string
		password  string
		uri       string
		notes     string
		totp      string
		jsonInput bool
	)
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new vault item",
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

			var data ItemData
			if jsonInput {
				// Stream a JSON document { "name": "...", "type": "...",
				// "data": { ... } } from stdin.
				var payload struct {
					Name string   `json:"name"`
					Type string   `json:"type"`
					Data ItemData `json:"data"`
				}
				raw, err := io.ReadAll(os.Stdin)
				if err != nil {
					return err
				}
				if err := json.Unmarshal(raw, &payload); err != nil {
					return fmt.Errorf("parse stdin: %w", err)
				}
				name = payload.Name
				if payload.Type != "" {
					itemType = payload.Type
				}
				data = payload.Data
			} else {
				if name == "" {
					return errors.New("--name is required when --json-input is not set")
				}
				data = ItemData{
					Username: username,
					Password: password,
					URI:      uri,
					Notes:    notes,
					TOTP:     totp,
				}
			}

			encryptedName, err := encryptItemName(vaultKey, name)
			if err != nil {
				return err
			}
			encryptedData, err := encryptItemData(vaultKey, data)
			if err != nil {
				return err
			}

			body := map[string]any{
				"itemType":      itemType,
				"encryptedName": encryptedName,
				"encryptedData": encryptedData,
			}
			raw, err := httpPost("/vaults/"+vaultMeta.ID+"/items", body, session)
			if err != nil {
				return err
			}
			var created apiItem
			if err := unmarshalJSON(raw, &created); err != nil {
				return err
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]string{"id": created.ID, "name": name})
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Created item %s (%s)\n", name, created.ID)
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Item display name (required)")
	cmd.Flags().StringVar(&itemType, "type", "login", "Item type (login, note, card, ...)")
	cmd.Flags().StringVar(&username, "username", "", "Login username")
	cmd.Flags().StringVar(&password, "password", "", "Login password")
	cmd.Flags().StringVar(&uri, "uri", "", "Login URI")
	cmd.Flags().StringVar(&notes, "notes", "", "Free-form notes")
	cmd.Flags().StringVar(&totp, "totp", "", "TOTP secret (base32)")
	cmd.Flags().BoolVar(&jsonInput, "json-input", false, "Read a JSON payload from stdin instead of flags")
	addVaultFlag(cmd)
	return cmd
}
