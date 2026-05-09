// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
)

// RefreshTokenBytes is the raw entropy length of refresh tokens. 32 bytes
// = 256 bits — matches the hash output size so attackers can't amplify
// short tokens via birthday search.
const RefreshTokenBytes = 32

// APIKeyBytes is the entropy length of API keys. 32 bytes = 256 bits.
const APIKeyBytes = 32

// InviteTokenBytes is the entropy length of org invite tokens (M11).
const InviteTokenBytes = 32

// APIKeyPrefix is the human-readable prefix stamped on every API key. The
// first 8 chars after the prefix are stored as api_keys.key_prefix for
// identification (PRD §9.7).
const APIKeyPrefix = "vk_"

// TokenGenerator issues high-entropy random tokens.
type TokenGenerator struct{}

// NewTokenGenerator constructs a TokenGenerator.
func NewTokenGenerator() *TokenGenerator { return &TokenGenerator{} }

// ErrTokenRead signals a failure to read from crypto/rand.
var ErrTokenRead = errors.New("tokens: rand.Read failed")

// RefreshToken returns a URL-safe base64 string carrying 256 bits of
// entropy. The raw token is returned to the caller — it MUST NOT be
// stored; callers persist hmac_sha256(server_pepper, token) instead (C3).
func (g *TokenGenerator) RefreshToken() (string, error) {
	return generate(RefreshTokenBytes)
}

// APIKey returns a full API key of the form "vk_<base64(entropy)>". The
// caller stores hmac_sha256(server_pepper, key) and shows the full value
// to the user exactly once (PRD §9.7).
func (g *TokenGenerator) APIKey() (string, error) {
	body, err := generate(APIKeyBytes)
	if err != nil {
		return "", err
	}
	return APIKeyPrefix + body, nil
}

// InviteToken returns a 256-bit random token for org invites (M11).
func (g *TokenGenerator) InviteToken() (string, error) {
	return generate(InviteTokenBytes)
}

func generate(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("%w: %v", ErrTokenRead, err) //nolint:errorlint // wrap sentinel only
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
