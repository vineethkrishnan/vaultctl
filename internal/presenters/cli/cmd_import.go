package cli

import (
	"encoding/csv"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

func newImportCmd() *cobra.Command {
	var format string
	cmd := &cobra.Command{
		Use:   "import <file>",
		Short: "Import items from a password manager export",
		Long: `Import items from a CSV export file. Supported formats:
  bitwarden   — Bitwarden CSV export (default)
  lastpass    — LastPass CSV export

All data is encrypted client-side before being sent to the server.`,
		Args: cobra.ExactArgs(1),
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

			file, err := os.Open(args[0])
			if err != nil {
				return fmt.Errorf("open file: %w", err)
			}
			defer func() { _ = file.Close() }()

			reader := csv.NewReader(file)
			records, err := reader.ReadAll()
			if err != nil {
				return fmt.Errorf("parse CSV: %w", err)
			}
			if len(records) < 2 {
				return fmt.Errorf("CSV file has no data rows")
			}

			parser := parseBitwardenCSV
			if strings.HasPrefix(strings.ToLower(format), "lastpass") {
				parser = parseLastPassCSV
			}

			items, err := parser(records)
			if err != nil {
				return err
			}

			var success, failed int
			for _, item := range items {
				encData, err := encryptItemData(vaultKey, item.Data)
				if err != nil {
					failed++
					continue
				}
				encName, err := encryptItemName(vaultKey, item.Name)
				if err != nil {
					failed++
					continue
				}
				body := map[string]any{
					"itemType":      item.Type,
					"encryptedData": encData,
					"encryptedName": encName,
					"favorite":      false,
					"reprompt":      false,
				}
				if _, err := httpPost("/vaults/"+vaultMeta.ID+"/items", body, session); err != nil {
					failed++
					continue
				}
				success++
			}

			result := map[string]int{"imported": success, "failed": failed, "total": len(items)}
			if isJSON(cmd) {
				return printJSON(cmd, result)
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Imported %d/%d items (%d failed)\n", success, len(items), failed)
			return nil
		},
	}
	cmd.Flags().StringVar(&format, "format", "bitwarden", "Import format: bitwarden, lastpass")
	addVaultFlag(cmd)
	return cmd
}

type importItem struct {
	Name string
	Type string
	Data ItemData
}

// parseBitwardenCSV parses Bitwarden's CSV export format.
// Header: folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
func parseBitwardenCSV(records [][]string) ([]importItem, error) {
	header := records[0]
	idx := csvIndex(header)

	var items []importItem
	for _, row := range records[1:] {
		name := csvCol(row, idx, "name")
		if name == "" {
			continue
		}
		itemType := csvCol(row, idx, "type")
		if itemType == "" {
			itemType = itemTypeLogin
		}

		items = append(items, importItem{
			Name: name,
			Type: mapItemType(itemType),
			Data: ItemData{
				Username: csvCol(row, idx, "login_username"),
				Password: csvCol(row, idx, "login_password"),
				TOTP:     csvCol(row, idx, "login_totp"),
				URI:      csvCol(row, idx, "login_uri"),
				Notes:    csvCol(row, idx, "notes"),
			},
		})
	}
	return items, nil
}

// parseLastPassCSV parses LastPass's CSV export format.
// Header: url,username,password,totp,extra,name,grouping,fav
func parseLastPassCSV(records [][]string) ([]importItem, error) {
	header := records[0]
	idx := csvIndex(header)

	var items []importItem
	for _, row := range records[1:] {
		name := csvCol(row, idx, "name")
		if name == "" {
			continue
		}
		itemType := itemTypeLogin
		if csvCol(row, idx, "url") == "http://sn" {
			itemType = itemTypeSecureNote
		}

		items = append(items, importItem{
			Name: name,
			Type: itemType,
			Data: ItemData{
				Username: csvCol(row, idx, "username"),
				Password: csvCol(row, idx, "password"),
				TOTP:     csvCol(row, idx, "totp"),
				URI:      csvCol(row, idx, "url"),
				Notes:    csvCol(row, idx, "extra"),
			},
		})
	}
	return items, nil
}

func csvIndex(header []string) map[string]int {
	idx := make(map[string]int, len(header))
	for i, h := range header {
		idx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	return idx
}

func csvCol(row []string, idx map[string]int, key string) string {
	i, ok := idx[key]
	if !ok || i >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[i])
}

const (
	itemTypeLogin      = "login"
	itemTypeSecureNote = "secure_note"
)

func mapItemType(raw string) string {
	switch strings.ToLower(raw) {
	case "login", "1":
		return itemTypeLogin
	case "note", "secure_note", "securenote", "2":
		return itemTypeSecureNote
	case "card", "credit_card", "3":
		return "credit_card"
	case "identity", "4":
		return "identity"
	default:
		return itemTypeLogin
	}
}
