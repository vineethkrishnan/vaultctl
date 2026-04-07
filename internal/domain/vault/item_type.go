package vault

import (
	"errors"
	"fmt"
)

// ItemType enumerates the seven supported vault item types (PRD §5.13).
//
// Why typed: the payload schema (required fields) depends entirely on the
// item type. A string-typed item_type lets handlers and CLIs accept any
// value; a typed enum lets the compiler catch switch statements that miss
// a case.
type ItemType string

const (
	ItemTypeLogin      ItemType = "login"
	ItemTypeSecureNote ItemType = "secure_note"
	ItemTypeCreditCard ItemType = "credit_card"
	ItemTypeIdentity   ItemType = "identity"
	ItemTypeAPIKey     ItemType = "api_key"
	ItemTypeSSHKey     ItemType = "ssh_key"
	ItemTypePasskey    ItemType = "passkey"
)

// AllItemTypes returns every supported ItemType in a stable order.
func AllItemTypes() []ItemType {
	return []ItemType{
		ItemTypeLogin,
		ItemTypeSecureNote,
		ItemTypeCreditCard,
		ItemTypeIdentity,
		ItemTypeAPIKey,
		ItemTypeSSHKey,
		ItemTypePasskey,
	}
}

// ErrInvalidItemType signals an unknown item_type value.
var ErrInvalidItemType = errors.New("vault: invalid item type")

// ParseItemType validates and returns the typed ItemType.
func ParseItemType(raw string) (ItemType, error) {
	t := ItemType(raw)
	if !t.IsValid() {
		return "", fmt.Errorf("%w: %q", ErrInvalidItemType, raw)
	}
	return t, nil
}

// IsValid reports whether t is an enumerated ItemType.
func (t ItemType) IsValid() bool {
	for _, known := range AllItemTypes() {
		if known == t {
			return true
		}
	}
	return false
}

// String returns the canonical string form.
func (t ItemType) String() string { return string(t) }

// RequiredFields returns the set of plaintext-field names that MUST be
// present inside the decrypted payload for an item of this type. The set is
// enforced client-side at item-save time, and is surfaced to CLIs / UIs to
// drive form validation.
//
// Fields stored INSIDE the encrypted payload only — the server never sees
// these; this list is the contract between crypto module and UI layer.
func (t ItemType) RequiredFields() []string {
	switch t {
	case ItemTypeLogin:
		return []string{"name", "username", "password"}
	case ItemTypeSecureNote:
		return []string{"name", "content"}
	case ItemTypeCreditCard:
		return []string{"name", "number", "expiry"}
	case ItemTypeIdentity:
		return []string{"name", "first_name", "last_name"}
	case ItemTypeAPIKey:
		return []string{"name", "key"}
	case ItemTypeSSHKey:
		return []string{"name", "private_key"}
	case ItemTypePasskey:
		return []string{"name", "rp_id", "credential_id", "public_key"}
	}
	return nil
}
