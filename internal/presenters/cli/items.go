// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/clientcrypto"
	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// apiItem mirrors the server's ItemResponse DTO so commands can decode list
// and get responses without pulling the api package (which would break the
// scope boundary on client/server separation).
type apiItem struct {
	ID            string  `json:"id"`
	VaultID       string  `json:"vaultId"`
	FolderID      *string `json:"folderId,omitempty"`
	ItemType      string  `json:"itemType"`
	EncryptedData string  `json:"encryptedData"`
	EncryptedName string  `json:"encryptedName"`
	Favorite      bool    `json:"favorite"`
	Reprompt      bool    `json:"reprompt"`
	Trashed       bool    `json:"trashed"`
	CreatedAt     string  `json:"createdAt"`
	UpdatedAt     string  `json:"updatedAt"`
}

// ItemData is the JSON structure carried inside the encrypted item blob.
// Matches the wire shape used by the TS and extension clients.
type ItemData struct {
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	TOTP     string `json:"totp,omitempty"`
	URI      string `json:"uri,omitempty"`
	Notes    string `json:"notes,omitempty"`
}

// decryptItemName opens the padded name blob and returns the plaintext
// string. The vault key is used as the AEAD key and no AAD is bound — this
// matches the TS encryption path in web/src/shared/crypto.
func decryptItemName(vaultKey []byte, encrypted string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return "", fmt.Errorf("decode name blob: %w", err)
	}
	blob, err := domaincrypto.ParseBlob(raw)
	if err != nil {
		return "", fmt.Errorf("parse name blob: %w", err)
	}
	padded, err := clientcrypto.Decrypt(vaultKey, blob, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt name: %w", err)
	}
	unpadded, err := clientcrypto.Unpad(padded)
	if err != nil {
		return "", err
	}
	return string(unpadded), nil
}

// encryptItemName is the inverse of decryptItemName.
func encryptItemName(vaultKey []byte, name string) (string, error) {
	padded := clientcrypto.Pad([]byte(name))
	blob, err := clientcrypto.Encrypt(vaultKey, padded, nil)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(blob.Bytes()), nil
}

// decryptItemData opens the item's JSON payload.
func decryptItemData(vaultKey []byte, encrypted string) (ItemData, error) {
	var data ItemData
	raw, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return data, fmt.Errorf("decode data blob: %w", err)
	}
	blob, err := domaincrypto.ParseBlob(raw)
	if err != nil {
		return data, fmt.Errorf("parse data blob: %w", err)
	}
	plaintext, err := clientcrypto.Decrypt(vaultKey, blob, nil)
	if err != nil {
		return data, fmt.Errorf("decrypt data: %w", err)
	}
	if err := json.Unmarshal(plaintext, &data); err != nil {
		return data, fmt.Errorf("parse item data: %w", err)
	}
	return data, nil
}

// encryptItemData is the inverse — JSON-encodes data then seals it.
func encryptItemData(vaultKey []byte, data ItemData) (string, error) {
	// The intermediate JSON carries cleartext fields (Password, TOTP, …)
	// on purpose — it is about to be sealed under the vault key on the
	// next line. gosec G117 flags the marshal because the struct has
	// "Password" in it, but this buffer never leaves the function.
	raw, err := json.Marshal(data) //nolint:gosec // G117: cleartext is re-sealed before return
	if err != nil {
		return "", err
	}
	blob, err := clientcrypto.Encrypt(vaultKey, raw, nil)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(blob.Bytes()), nil
}

// findItemByName walks decrypted item names to find an exact match. The
// search is case-insensitive via strings.EqualFold logic below.
func findItemByName(items []apiItem, vaultKey []byte, name string) (apiItem, error) {
	for _, it := range items {
		decoded, err := decryptItemName(vaultKey, it.EncryptedName)
		if err != nil {
			continue
		}
		if equalFold(decoded, name) {
			return it, nil
		}
	}
	return apiItem{}, errors.New("item not found")
}

// equalFold is a zero-alloc ASCII case-insensitive equality check.
func equalFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if 'A' <= ca && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if 'A' <= cb && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}
