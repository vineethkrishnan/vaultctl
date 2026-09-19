// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func sealedLogin(t *testing.T, key []byte, id, name string, data ItemData) apiItem {
	t.Helper()
	encName, err := encryptItemName(key, name)
	if err != nil {
		t.Fatal(err)
	}
	encData, err := encryptItemData(key, data)
	if err != nil {
		t.Fatal(err)
	}
	return apiItem{ID: id, ItemType: itemTypeLogin, EncryptedName: encName, EncryptedData: encData}
}

func TestFindLoginsForHost(t *testing.T) {
	personalKey := bytes.Repeat([]byte{0x11}, 32)
	sharedKey := bytes.Repeat([]byte{0x22}, 32)
	byVault := map[string][]apiItem{
		"v-personal": {
			sealedLogin(t, personalKey, "i-1", "Teleport", ItemData{Username: "vineeth", Password: "p1", URI: "https://teleport.locaboo.de"}),
			sealedLogin(t, personalKey, "i-2", "Teleport admin", ItemData{Username: "admin", Password: "p2", URI: "https://www.teleport.locaboo.de"}),
			sealedLogin(t, personalKey, "i-3", "Other", ItemData{Username: "x", URI: "https://other.example.com"}),
		},
		"v-shared": {
			sealedLogin(t, sharedKey, "i-4", "Shared teleport", ItemData{Username: "ops", URI: "teleport.locaboo.de"}),
		},
		"v-locked": {
			sealedLogin(t, sharedKey, "i-5", "Unreachable", ItemData{Username: "nope", URI: "teleport.locaboo.de"}),
		},
	}
	trashed := sealedLogin(t, personalKey, "i-6", "Trashed", ItemData{Username: "old", URI: "teleport.locaboo.de"})
	trashed.Trashed = true
	byVault["v-personal"] = append(byVault["v-personal"], trashed)
	note := sealedLogin(t, personalKey, "i-7", "Note", ItemData{URI: "teleport.locaboo.de"})
	note.ItemType = "secure_note"
	byVault["v-personal"] = append(byVault["v-personal"], note)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for id, items := range byVault {
			if r.URL.Path == "/api/v1/vaults/"+id+"/items" {
				_ = json.NewEncoder(w).Encode(items)
				return
			}
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	t.Setenv(envServer, srv.URL)

	session := &Session{AccessToken: "at", Vaults: []SessionVault{
		{ID: "v-personal", Name: "Personal"}, {ID: "v-shared", Name: "Shared"}, {ID: "v-locked", Name: "Locked"},
	}}
	keys := &Keys{VaultKeys: map[string][]byte{"v-personal": personalKey, "v-shared": sharedKey}}

	matches, err := findLoginsForHost(session, keys, "teleport.locaboo.de", "")
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(matches))
	for _, m := range matches {
		ids = append(ids, m.Item.ID)
	}
	if len(ids) != 3 || ids[0] != "i-1" || ids[1] != "i-2" || ids[2] != "i-4" {
		t.Errorf("ids = %v, want [i-1 i-2 i-4]", ids)
	}
	if matches[0].Name != "Teleport" || matches[0].Data.Password != "p1" || matches[0].Vault.ID != "v-personal" {
		t.Errorf("first match not decrypted: %+v", matches[0])
	}

	narrowed, err := findLoginsForHost(session, keys, "teleport.locaboo.de", "ADMIN")
	if err != nil {
		t.Fatal(err)
	}
	if len(narrowed) != 1 || narrowed[0].Item.ID != "i-2" {
		t.Errorf("username filter: %+v", narrowed)
	}

	none, err := findLoginsForHost(session, keys, "nowhere.example", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(none) != 0 {
		t.Errorf("expected no matches, got %+v", none)
	}
}
