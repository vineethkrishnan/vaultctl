// SPDX-License-Identifier: AGPL-3.0-or-later

package ports

import (
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// AuthHasher is the server-side Argon2id re-hash (infrastructure/auth).
type AuthHasher interface {
	// Hash derives a PHC-encoded Argon2id hash of input.
	Hash(input []byte) (string, error)
	// Verify compares input against the stored PHC hash. `upgrade=true`
	// signals that the stored hash used weaker parameters than the current
	// server defaults and should be re-hashed on next successful login.
	Verify(input []byte, encoded string) (ok, upgrade bool, err error)
}

// HMACer hashes refresh tokens (C3), API keys (H7), and produces the
// enumeration salt for prelogin (H2).
type HMACer interface {
	// Hash returns HMAC-SHA256(server_pepper, input).
	Hash(input []byte) []byte
	// HashString is a convenience for token-shaped inputs.
	HashString(input string) []byte
	// Equal is a constant-time comparison of two digests.
	Equal(a, b []byte) bool
	// EnumerationSalt returns HMAC-SHA256(enumeration_pepper,
	// normalisedEmail) for the H2 prelogin fake-salt branch.
	EnumerationSalt(normalizedEmail string) []byte
}

// TokenIssuer issues and verifies access tokens. The port-level shape
// deliberately mirrors the infrastructure AccessClaims so that use cases
// can carry the step-up claim around.
type TokenIssuer interface {
	// Issue returns a signed access token. stepUpUntil may be zero when no
	// fresh master-password proof is attached.
	Issue(userID, role string, now time.Time, stepUpUntil time.Time) (string, error)
	// Verify parses and validates an access token, returning the claims.
	Verify(token string) (AccessClaims, error)
}

// AccessClaims is the ports-layer view of a verified access token. It is a
// pure data struct so the application doesn't depend on the JWT lib.
type AccessClaims struct {
	UserID      string
	Role        string
	StepUpUntil time.Time
}

// HasValidStepUp reports whether a fresh-reauth proof is still valid at now
// (H10). Zero-valued StepUpUntil means no step-up claim is present.
func (c AccessClaims) HasValidStepUp(now time.Time) bool {
	if c.StepUpUntil.IsZero() {
		return false
	}
	return c.StepUpUntil.After(now)
}

// TokenGenerator produces fresh random tokens.
type TokenGenerator interface {
	RefreshToken() (string, error)
	APIKey() (string, error)
	InviteToken() (string, error)
}

// DataEncrypter wraps the server-side AES-GCM service for totp_secret /
// password_hint. The AAD ties a ciphertext to a specific row so cut-and-
// paste between users/fields is rejected by the AEAD.
type DataEncrypter interface {
	Encrypt(plaintext, aad []byte) (crypto.EncryptedBlob, error)
	Decrypt(blob crypto.EncryptedBlob, aad []byte) ([]byte, error)
}

// TOTPProvider generates and verifies TOTP codes (H6 counter tracking).
type TOTPProvider interface {
	// Generate creates a new base32-encoded TOTP secret and the matching
	// otpauth:// URL used to render QR codes.
	Generate(issuer, account string) (secret string, otpauthURL string, err error)
	// Verify checks code against secret. Returns the 30-second counter of
	// the matched window (for H6 replay protection) and whether the code
	// was accepted.
	Verify(secret, code string, now time.Time) (counter int64, ok bool)
}

// Re-export the user-domain kdf shape for handler wiring convenience.
type UserKDFParams = user.KDFParams
