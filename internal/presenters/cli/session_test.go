package cli

import (
	"errors"
	"os"
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
	_ = os.Unsetenv(envAPIKey)

	original := &Session{
		UserID:      "u-1",
		Email:       "alice@example.com",
		AccessToken: "at",
		Vaults: []SessionVault{
			{ID: "v-1", Name: "Personal", Type: "personal", Role: "owner"},
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
}

func TestLoadSession_NoneReturnsSentinel(t *testing.T) {
	keyring.MockInit()
	_ = os.Unsetenv(envAPIKey)

	_, err := LoadSession()
	if !errors.Is(err, ErrNoSession) {
		t.Errorf("err = %v, want ErrNoSession", err)
	}
}

func TestClearSession_IdempotentOnMissing(t *testing.T) {
	keyring.MockInit()
	if err := ClearSession(); err != nil {
		t.Errorf("clear on empty keychain should be a no-op, got %v", err)
	}
}

func TestSaveSession_APIKeyModeIsNoop(t *testing.T) {
	keyring.MockInit()
	session := &Session{APIKey: "pk_x"}
	if err := SaveSession(session); err != nil {
		t.Errorf("save: %v", err)
	}
	if _, err := keyring.Get(keychainService, keychainUser); !errors.Is(err, keyring.ErrNotFound) {
		t.Errorf("api-key mode should not persist to keychain, got err=%v", err)
	}
}
