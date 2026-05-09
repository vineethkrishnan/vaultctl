// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/spf13/cobra"
)

func newEditCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "edit <name>",
		Short: "Open an item in $EDITOR, save back encrypted",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			editor := os.Getenv("EDITOR")
			if editor == "" {
				return errors.New("$EDITOR is not set")
			}
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
			payload := map[string]any{
				"name": args[0],
				"type": match.ItemType,
				"data": data,
			}
			pretty, err := json.MarshalIndent(payload, "", "  ")
			if err != nil {
				return err
			}

			tmp, err := os.CreateTemp("", "vaultctl-edit-*.json")
			if err != nil {
				return err
			}
			tmpPath := tmp.Name()
			defer func() { _ = os.Remove(tmpPath) }()
			if _, err := tmp.Write(pretty); err != nil {
				_ = tmp.Close()
				return err
			}
			_ = tmp.Close()

			// editor comes from $EDITOR / --editor; tmpPath is a path
			// returned by os.CreateTemp under a directory we control.
			// gosec G702 flags any exec.Command with a variable path, and
			// G304 flags any ReadFile with a variable path — both false
			// positives for an editor-based edit flow where the whole
			// point is to hand a user-chosen program a file we produced.
			edit := exec.Command(editor, filepath.Clean(tmpPath)) //nolint:gosec // G702: editor + temp path are intentional
			edit.Stdin = os.Stdin
			edit.Stdout = os.Stdout
			edit.Stderr = os.Stderr
			if err := edit.Run(); err != nil {
				return fmt.Errorf("editor: %w", err)
			}
			edited, err := os.ReadFile(tmpPath) //nolint:gosec // G304: our own temp file
			if err != nil {
				return err
			}
			var updated struct {
				Name string   `json:"name"`
				Type string   `json:"type"`
				Data ItemData `json:"data"`
			}
			if err := json.Unmarshal(edited, &updated); err != nil {
				return fmt.Errorf("parse edited json: %w", err)
			}

			encryptedName, err := encryptItemName(vaultKey, updated.Name)
			if err != nil {
				return err
			}
			encryptedData, err := encryptItemData(vaultKey, updated.Data)
			if err != nil {
				return err
			}
			body := map[string]any{
				"encryptedName": encryptedName,
				"encryptedData": encryptedData,
			}
			if _, err := httpPut("/vaults/"+vaultMeta.ID+"/items/"+match.ID, body, session); err != nil {
				return err
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]string{"status": "updated", "id": match.ID})
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Updated %s\n", updated.Name)
			return nil
		},
	}
	addVaultFlag(cmd)
	return cmd
}
