// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/zalando/go-keyring"
)

// keychainService / keychainUser identify the vaultctl session blob inside
// the OS keychain. Only one session is kept at a time; multi-account users
// should rely on the VAULTCTL_API_KEY env var instead.
const (
	keychainService = "vaultctl"
	keychainUser    = "session"

	envAPIKey      = "VAULTCTL_API_KEY" //nolint:gosec // G101: env var NAME, not a value
	envServer      = "VAULTCTL_SERVER"
	envActiveVault = "VAULTCTL_VAULT"

	defaultServerURL = "https://localhost:8080"
)

// SessionVault is the minimal metadata needed to drive per-vault commands
// without round-tripping the server on every invocation.
type SessionVault struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Type              string `json:"type"`
	Role              string `json:"role"`
	EncryptedVaultKey string `json:"encryptedVaultKey"` // base64 wire blob
	SenderID          string `json:"senderId"`
}

// Session is what we persist inside the OS keychain (JSON-encoded). The
// stretched key is NEVER written to disk; it lives only in the in-memory
// Keys cache attached to one CLI invocation.
type Session struct {
	UserID                      string         `json:"userId"`
	Email                       string         `json:"email"`
	Role                        string         `json:"role"`
	AccessToken                 string         `json:"accessToken"`
	RefreshToken                string         `json:"refreshToken"`
	RefreshExpiresAt            string         `json:"refreshExpiresAt"`
	EncryptedPrivateKey         string         `json:"encryptedPrivateKey"`         // base64 wire blob
	EncryptedIdentityPrivateKey string         `json:"encryptedIdentityPrivateKey"` // base64 wire blob
	PublicKey                   string         `json:"publicKey"`
	IdentityPublicKey           string         `json:"identityPublicKey"`
	Vaults                      []SessionVault `json:"vaults"`
	ActiveVaultID               string         `json:"activeVaultId,omitempty"`

	// APIKey short-circuits the password-derived flow. When set via
	// VAULTCTL_API_KEY the CLI uses bearer header auth and all
	// decryption-requiring commands fail loudly.
	APIKey string `json:"-"`
}

// ErrNoSession indicates the user needs to log in (neither a keychain entry
// nor a VAULTCTL_API_KEY were found).
var ErrNoSession = errors.New("no active vaultctl session; run `vaultctl login` or set VAULTCTL_API_KEY")

// LoadSession returns the current session, honouring VAULTCTL_API_KEY first
// and the OS keychain second. ErrNoSession is returned when neither is
// available.
func LoadSession() (*Session, error) {
	if apiKey := os.Getenv(envAPIKey); apiKey != "" {
		return &Session{APIKey: apiKey}, nil
	}
	raw, err := keyring.Get(keychainService, keychainUser)
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) {
			return nil, ErrNoSession
		}
		return nil, fmt.Errorf("keychain: %w", err)
	}
	var session Session
	if err := json.Unmarshal([]byte(raw), &session); err != nil {
		return nil, fmt.Errorf("decode session: %w", err)
	}
	return &session, nil
}

// SaveSession persists the session to the OS keychain, overwriting any
// previous entry. Does not touch the keychain when the caller is
// API-key-driven.
func SaveSession(session *Session) error {
	if session == nil {
		return errors.New("cli: nil session")
	}
	if session.APIKey != "" {
		return nil // API-key mode is stateless
	}
	// AccessToken + RefreshToken are stored in the OS keychain so they
	// survive across CLI invocations. gosec G117 flags the marshal
	// because the struct field name matches a "secret" pattern, but
	// persisting tokens in an OS-keyring-backed store is exactly what
	// the session helper is for.
	raw, err := json.Marshal(session) //nolint:gosec // G117: intentional keychain persistence
	if err != nil {
		return fmt.Errorf("encode session: %w", err)
	}
	return keyring.Set(keychainService, keychainUser, string(raw))
}

// ClearSession removes the keychain entry. A missing entry is not an error.
func ClearSession() error {
	err := keyring.Delete(keychainService, keychainUser)
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return err
	}
	return nil
}
