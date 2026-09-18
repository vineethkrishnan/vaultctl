// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import "fmt"

// loginMatch is one decrypted login item together with the vault it lives in.
type loginMatch struct {
	Vault SessionVault
	Item  apiItem
	Name  string
	Data  ItemData
}

// findLoginsForHost returns every non-trashed login across the session's
// vaults whose uri host matches host, narrowed to username when one is
// given. Vaults whose key is not in keys are skipped rather than failing,
// so a locked shared vault never blocks a fill from the personal one.
func findLoginsForHost(session *Session, keys *Keys, host, username string) ([]loginMatch, error) {
	var matches []loginMatch
	for _, vaultMeta := range session.Vaults {
		vaultKey, ok := keys.VaultKeys[vaultMeta.ID]
		if !ok {
			continue
		}
		raw, err := httpGet("/vaults/"+vaultMeta.ID+"/items", session)
		if err != nil {
			return nil, fmt.Errorf("list items of vault %q: %w", vaultMeta.Name, err)
		}
		var items []apiItem
		if err := unmarshalJSON(raw, &items); err != nil {
			return nil, err
		}
		for _, item := range items {
			if item.Trashed || item.ItemType != itemTypeLogin {
				continue
			}
			data, err := decryptItemData(vaultKey, item.EncryptedData)
			if err != nil {
				continue
			}
			if !hostMatches(safeHost(data.URI), host) {
				continue
			}
			if username != "" && !equalFold(data.Username, username) {
				continue
			}
			name, err := decryptItemName(vaultKey, item.EncryptedName)
			if err != nil {
				continue
			}
			matches = append(matches, loginMatch{Vault: vaultMeta, Item: item, Name: name, Data: data})
		}
	}
	return matches, nil
}
