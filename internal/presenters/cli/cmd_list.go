package cli

import (
	"sort"

	"github.com/spf13/cobra"
)

func newListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List items in the active vault",
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

			raw, err := httpGet("/vaults/"+vaultMeta.ID+"/items", session)
			if err != nil {
				return err
			}
			var items []apiItem
			if err := unmarshalJSON(raw, &items); err != nil {
				return err
			}

			type entry struct {
				ID       string `json:"id"`
				Name     string `json:"name"`
				Type     string `json:"type"`
				Favorite bool   `json:"favorite"`
			}
			decoded := make([]entry, 0, len(items))
			for _, it := range items {
				name, err := decryptItemName(vaultKey, it.EncryptedName)
				if err != nil {
					name = "<unreadable>"
				}
				decoded = append(decoded, entry{
					ID: it.ID, Name: name, Type: it.ItemType, Favorite: it.Favorite,
				})
			}
			sort.Slice(decoded, func(i, j int) bool { return decoded[i].Name < decoded[j].Name })

			if isJSON(cmd) {
				return printJSON(cmd, decoded)
			}
			rows := make([][]string, 0, len(decoded))
			for _, d := range decoded {
				star := ""
				if d.Favorite {
					star = "*"
				}
				rows = append(rows, []string{d.Name, d.Type, d.ID, star})
			}
			return printTable(cmd, []string{"NAME", "TYPE", "ID", "FAV"}, rows)
		},
	}
	addVaultFlag(cmd)
	return cmd
}
