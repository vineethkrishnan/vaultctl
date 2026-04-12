package cli

import (
	"bytes"
	"testing"
)

func TestItemNameRoundTrip(t *testing.T) {
	key := bytes.Repeat([]byte{0x55}, 32)
	for _, name := range []string{"", "GitHub", "🦊 Firefox", "a very long item name that exceeds thirty-two bytes"} {
		encoded, err := encryptItemName(key, name)
		if err != nil {
			t.Fatalf("encrypt %q: %v", name, err)
		}
		decoded, err := decryptItemName(key, encoded)
		if err != nil {
			t.Fatalf("decrypt %q: %v", name, err)
		}
		if decoded != name {
			t.Errorf("round trip mismatch: got %q want %q", decoded, name)
		}
	}
}

func TestItemDataRoundTrip(t *testing.T) {
	key := bytes.Repeat([]byte{0x77}, 32)
	data := ItemData{
		Username: "alice",
		Password: "hunter2",
		URI:      "https://example.com",
		TOTP:     "JBSWY3DPEHPK3PXP",
		Notes:    "rotated 2026-01-01",
	}
	encoded, err := encryptItemData(key, data)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	got, err := decryptItemData(key, encoded)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != data {
		t.Errorf("round trip mismatch: %+v vs %+v", got, data)
	}
}

func TestFindItemByName_CaseInsensitive(t *testing.T) {
	key := bytes.Repeat([]byte{0x11}, 32)
	encName, err := encryptItemName(key, "GitHub")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	items := []apiItem{{ID: "id-1", EncryptedName: encName}}
	match, err := findItemByName(items, key, "github")
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if match.ID != "id-1" {
		t.Errorf("wrong match: %+v", match)
	}
	if _, err := findItemByName(items, key, "absent"); err == nil {
		t.Errorf("expected not-found")
	}
}
