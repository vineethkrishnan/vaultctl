// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/zalando/go-keyring"
)

// keychainService / keychainUser identify the vaultctl session tokens inside
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

// Session is what we persist between invocations: tokens in the OS
// keychain, everything else (all ciphertext or public data) in the session
// file. The stretched key is NEVER written to disk; it lives in memory in
// one invocation or in the agent.
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

// sessionTokens is the part of the session that lives in the OS keychain.
// The macOS keychain backend refuses entries over ~4 KB, and the encrypted
// key blobs alone exceed that, so only the bearer tokens go there. The
// blobs are ciphertext under the master key (the same bytes the server and
// the web app hold) and live in a 0600 file next to the config.
type sessionTokens struct {
	AccessToken      string `json:"accessToken"`
	RefreshToken     string `json:"refreshToken"`
	RefreshExpiresAt string `json:"refreshExpiresAt"`
}

// sessionRecord is the on-disk part: identity, public keys, the encrypted
// private keys and the wrapped vault keys. It has no token fields, so the
// bearer tokens cannot end up in the file.
type sessionRecord struct {
	UserID                      string         `json:"userId"`
	Email                       string         `json:"email"`
	Role                        string         `json:"role"`
	EncryptedPrivateKey         string         `json:"encryptedPrivateKey"`
	EncryptedIdentityPrivateKey string         `json:"encryptedIdentityPrivateKey"`
	PublicKey                   string         `json:"publicKey"`
	IdentityPublicKey           string         `json:"identityPublicKey"`
	Vaults                      []SessionVault `json:"vaults"`
	ActiveVaultID               string         `json:"activeVaultId,omitempty"`
}

func sessionPath() (string, error) {
	path, err := configPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(path), "session.json"), nil
}

// LoadSession returns the current session, honouring VAULTCTL_API_KEY first
// and the keychain + session file second. ErrNoSession is returned when
// neither is available.
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
	var tokens sessionTokens
	if err := json.Unmarshal([]byte(raw), &tokens); err != nil {
		return nil, fmt.Errorf("decode session tokens: %w", err)
	}
	session, err := readSessionFile()
	if err != nil {
		return nil, err
	}
	if session == nil {
		// A keychain entry written before the split holds the whole
		// session; keep honouring it until the next save migrates it.
		session = &Session{}
		if err := json.Unmarshal([]byte(raw), session); err != nil || session.UserID == "" {
			return nil, ErrNoSession
		}
	}
	session.AccessToken = tokens.AccessToken
	session.RefreshToken = tokens.RefreshToken
	session.RefreshExpiresAt = tokens.RefreshExpiresAt
	return session, nil
}

func readSessionFile() (*Session, error) {
	path, err := sessionPath()
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path) //nolint:gosec // G304: fixed path under the user config dir
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read session: %w", err)
	}
	var record sessionRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		return nil, fmt.Errorf("decode session: %w", err)
	}
	return &Session{
		UserID: record.UserID, Email: record.Email, Role: record.Role,
		EncryptedPrivateKey: record.EncryptedPrivateKey, EncryptedIdentityPrivateKey: record.EncryptedIdentityPrivateKey,
		PublicKey: record.PublicKey, IdentityPublicKey: record.IdentityPublicKey,
		Vaults: record.Vaults, ActiveVaultID: record.ActiveVaultID,
	}, nil
}

// SaveSession persists the tokens to the OS keychain and the rest to the
// session file, overwriting any previous entry. Does not touch either when
// the caller is API-key-driven.
func SaveSession(session *Session) error {
	if session == nil {
		return errors.New("cli: nil session")
	}
	if session.APIKey != "" {
		return nil // API-key mode is stateless
	}
	// The tokens are the only secrets and go to the OS keyring; gosec G117
	// flags the marshal on the field names, which is exactly the intent.
	tokens, err := json.Marshal(sessionTokens{ //nolint:gosec // G117: intentional keychain persistence
		AccessToken: session.AccessToken, RefreshToken: session.RefreshToken, RefreshExpiresAt: session.RefreshExpiresAt,
	})
	if err != nil {
		return fmt.Errorf("encode session tokens: %w", err)
	}
	if err := keyring.Set(keychainService, keychainUser, string(tokens)); err != nil {
		return fmt.Errorf("keychain: %w", err)
	}
	raw, err := json.MarshalIndent(sessionRecord{
		UserID: session.UserID, Email: session.Email, Role: session.Role,
		EncryptedPrivateKey: session.EncryptedPrivateKey, EncryptedIdentityPrivateKey: session.EncryptedIdentityPrivateKey,
		PublicKey: session.PublicKey, IdentityPublicKey: session.IdentityPublicKey,
		Vaults: session.Vaults, ActiveVaultID: session.ActiveVaultID,
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode session: %w", err)
	}
	path, err := sessionPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil { //nolint:gosec // G703: fixed path under the user config dir
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

// ClearSession removes the keychain entry and the session file. Missing
// entries are not an error.
func ClearSession() error {
	err := keyring.Delete(keychainService, keychainUser)
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return err
	}
	path, err := sessionPath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
