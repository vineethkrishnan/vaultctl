// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

func TestLoadSession_APIKeyWins(t *testing.T) {
	// Force a fake keychain so the test doesn't touch the host's keystore.
	keyring.MockInit()
	t.Setenv(envAPIKey, "pk_live_xyz")

	session, err := LoadSession()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if session.APIKey != "pk_live_xyz" {
		t.Errorf("APIKey = %q, want pk_live_xyz", session.APIKey)
	}
	if session.AccessToken != "" {
		t.Errorf("AccessToken should be empty in api-key mode")
	}
}

func TestSaveLoadSession_KeychainRoundTrip(t *testing.T) {
	keyring.MockInit()
	useTempConfig(t)
	_ = os.Unsetenv(envAPIKey)

	original := &Session{
		UserID:              "u-1",
		Email:               "alice@example.com",
		AccessToken:         "at",
		RefreshToken:        "rt",
		RefreshExpiresAt:    "2030-01-01T00:00:00Z",
		EncryptedPrivateKey: strings.Repeat("A", 6000),
		Vaults: []SessionVault{
			{ID: "v-1", Name: "Personal", Type: "personal", Role: "owner", EncryptedVaultKey: strings.Repeat("B", 1000)},
		},
		ActiveVaultID: "v-1",
	}
	if err := SaveSession(original); err != nil {
		t.Fatalf("save: %v", err)
	}
	loaded, err := LoadSession()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.Email != "alice@example.com" || loaded.ActiveVaultID != "v-1" || len(loaded.Vaults) != 1 {
		t.Errorf("round-trip mismatch: %+v", loaded)
	}
	if loaded.AccessToken != "at" || loaded.RefreshToken != "rt" || loaded.EncryptedPrivateKey != original.EncryptedPrivateKey {
		t.Errorf("tokens or blobs lost: %+v", loaded)
	}

	inKeychain, err := keyring.Get(keychainService, keychainUser)
	if err != nil {
		t.Fatal(err)
	}
	if len(inKeychain) > 512 || strings.Contains(inKeychain, "AAAA") {
		t.Errorf("keychain entry must hold only the tokens, got %d bytes", len(inKeychain))
	}
	path, _ := sessionPath()
	onDisk, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(onDisk), `"at"`) || strings.Contains(string(onDisk), `"rt"`) {
		t.Errorf("tokens must not be written to disk: %s", onDisk)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0o600 {
		t.Errorf("session file perm = %o", info.Mode().Perm())
	}
	if err := ClearSession(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Error("clear should remove the session file")
	}
	if _, err := LoadSession(); !errors.Is(err, ErrNoSession) {
		t.Errorf("after clear: %v", err)
	}
}

func TestLoadSession_MigratesWholeSessionKeychainEntry(t *testing.T) {
	keyring.MockInit()
	useTempConfig(t)
	_ = os.Unsetenv(envAPIKey)
	legacy := `{"userId":"u-9","email":"old@example.com","accessToken":"at9","refreshToken":"rt9","vaults":[{"id":"v-9"}]}`
	if err := keyring.Set(keychainService, keychainUser, legacy); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadSession()
	if err != nil {
		t.Fatalf("load legacy: %v", err)
	}
	if loaded.UserID != "u-9" || loaded.AccessToken != "at9" || len(loaded.Vaults) != 1 {
		t.Errorf("legacy entry not honoured: %+v", loaded)
	}
	if err := SaveSession(loaded); err != nil {
		t.Fatal(err)
	}
	if inKeychain, _ := keyring.Get(keychainService, keychainUser); strings.Contains(inKeychain, "u-9") {
		t.Error("save should have moved the bulk out of the keychain")
	}
}

func TestLoadSession_NoneReturnsSentinel(t *testing.T) {
	keyring.MockInit()
	useTempConfig(t)
	_ = os.Unsetenv(envAPIKey)

	_, err := LoadSession()
	if !errors.Is(err, ErrNoSession) {
		t.Errorf("err = %v, want ErrNoSession", err)
	}
}

func TestClearSession_IdempotentOnMissing(t *testing.T) {
	keyring.MockInit()
	useTempConfig(t)
	if err := ClearSession(); err != nil {
		t.Errorf("clear on empty keychain should be a no-op, got %v", err)
	}
}

func TestSaveSession_APIKeyModeIsNoop(t *testing.T) {
	keyring.MockInit()
	useTempConfig(t)
	session := &Session{APIKey: "pk_x"}
	if err := SaveSession(session); err != nil {
		t.Errorf("save: %v", err)
	}
	if _, err := keyring.Get(keychainService, keychainUser); !errors.Is(err, keyring.ErrNotFound) {
		t.Errorf("api-key mode should not persist to keychain, got err=%v", err)
	}
}
