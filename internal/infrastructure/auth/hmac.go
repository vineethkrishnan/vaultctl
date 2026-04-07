package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"strings"
)

// ErrEmptyPepper indicates a misconfigured HMAC pepper — either the server
// pepper or the enumeration pepper. Fail fast at startup.
var ErrEmptyPepper = errors.New("auth: HMAC pepper is empty")

// HMACService produces the HMAC digests required by the security review:
//   - C3: HMAC(server_pepper, refresh_token) for sessions.refresh_token_hash
//   - H7: HMAC(server_pepper, api_key) for api_keys.key_hash
//   - H2: HMAC(enumeration_pepper, email) for prelogin fake-salt
//
// The service never handles raw secrets for longer than one call.
type HMACService struct {
	serverPepper      []byte
	enumerationPepper []byte
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
		serverPepper:      []byte(serverPepper),
		enumerationPepper: []byte(enumerationPepper),
	}, nil
}

// Hash computes HMAC-SHA256(serverPepper, input). Used for refresh-token and
// API-key hashing.
func (s *HMACService) Hash(input []byte) []byte {
	m := hmac.New(sha256.New, s.serverPepper)
	m.Write(input)
	return m.Sum(nil)
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
	m := hmac.New(sha256.New, s.enumerationPepper)
	m.Write([]byte(normalizedEmail))
	return m.Sum(nil)
}
