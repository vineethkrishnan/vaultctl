// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"strings"

	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/secure"
)

// ErrEmptyPepper indicates a misconfigured HMAC pepper — either the server
// pepper or the enumeration pepper. Fail fast at startup.
var ErrEmptyPepper = errors.New("auth: HMAC pepper is empty")

// HMACService produces the HMAC digests required by the security review:
//   - C3: HMAC(server_pepper, refresh_token) for sessions.refresh_token_hash
//   - H7: HMAC(server_pepper, api_key) for api_keys.key_hash
//   - H2: HMAC(enumeration_pepper, email) for prelogin fake-salt
//
// Peppers live inside memguard LockedBuffers for the process lifetime and
// are borrowed through Secret.Open only for the narrow HMAC call window.
type HMACService struct {
	serverPepper      *secure.Secret
	enumerationPepper *secure.Secret
}

// NewHMACService builds an HMACService. Both peppers are required and MUST
// be non-empty in production — the Config layer enforces this at load time,
// but we defensively check again here.
func NewHMACService(serverPepper, enumerationPepper string) (*HMACService, error) {
	if strings.TrimSpace(serverPepper) == "" {
		return nil, ErrEmptyPepper
	}
	if strings.TrimSpace(enumerationPepper) == "" {
		return nil, ErrEmptyPepper
	}
	return &HMACService{
		serverPepper:      secure.NewSecretFromString(serverPepper),
		enumerationPepper: secure.NewSecretFromString(enumerationPepper),
	}, nil
}

// Hash computes HMAC-SHA256(serverPepper, input). Used for refresh-token and
// API-key hashing.
func (s *HMACService) Hash(input []byte) []byte {
	var out []byte
	s.serverPepper.Open(func(key []byte) {
		m := hmac.New(sha256.New, key)
		m.Write(input)
		out = m.Sum(nil)
	})
	return out
}

// HashString is a string-input convenience for tokens.
func (s *HMACService) HashString(input string) []byte {
	return s.Hash([]byte(input))
}

// Equal performs a constant-time comparison of two digests.
func (s *HMACService) Equal(a, b []byte) bool {
	return subtle.ConstantTimeCompare(a, b) == 1
}

// EnumerationSalt returns HMAC-SHA256(enumerationPepper, normalizedEmail).
// Used by the prelogin handler to produce a deterministic pseudo-salt for
// unknown emails (H2). The normalised email MUST come from user.Email.String().
func (s *HMACService) EnumerationSalt(normalizedEmail string) []byte {
	var out []byte
	s.enumerationPepper.Open(func(key []byte) {
		m := hmac.New(sha256.New, key)
		m.Write([]byte(normalizedEmail))
		out = m.Sum(nil)
	})
	return out
}

// Close wipes both peppers. Call from the server shutdown path.
func (s *HMACService) Close() {
	s.serverPepper.Destroy()
	s.enumerationPepper.Destroy()
}
