// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"errors"
	"fmt"
	"time"

	"github.com/pquerna/otp/totp"
	"github.com/spf13/cobra"
)

func newTotpCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "totp <name>",
		Short: "Print the current TOTP code for an item",
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
			if data.TOTP == "" {
				return errors.New("item has no TOTP secret")
			}
			code, err := totp.GenerateCode(data.TOTP, time.Now())
			if err != nil {
				return err
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]any{
					"code": code, "item": args[0], "generatedAt": time.Now().Unix(),
				})
			}
			_, _ = fmt.Fprintln(cmd.OutOrStdout(), code)
			return nil
		},
	}
	addVaultFlag(cmd)
	return cmd
}
