// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

// TOTPProvider implements ports.TOTPProvider using pquerna/otp.
type TOTPProvider struct{}

// NewTOTPProvider returns a new TOTP provider.
func NewTOTPProvider() *TOTPProvider { return &TOTPProvider{} }

// Generate creates a new base32-encoded TOTP secret and otpauth:// URL.
func (p *TOTPProvider) Generate(issuer, account string) (string, string, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: account,
		Period:      30,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1, // RFC 6238 default, widest authenticator support
	})
	if err != nil {
		return "", "", err
	}
	return key.Secret(), key.URL(), nil
}

// Verify checks code against secret. Returns the 30-second counter window
// that matched (for H6 replay protection) and whether the code was valid.
func (p *TOTPProvider) Verify(secret, code string, now time.Time) (int64, bool) {
	ok, err := totp.ValidateCustom(code, secret, now, totp.ValidateOpts{
		Period:    30,
		Skew:     1, // Allow 1 window of clock drift (±30s)
		Digits:   otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	if err != nil || !ok {
		return 0, false
	}
	// Compute the counter for the current 30s window
	counter := now.Unix() / 30
	return counter, true
}
