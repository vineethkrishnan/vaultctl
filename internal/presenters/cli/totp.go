// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"errors"
	"strings"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

// totpCodeAt generates the code for an item's totp field at the given time.
// The field holds either a bare base32 secret or a full otpauth:// URI (the
// form the web app stores after a QR scan), whose digits, period and
// algorithm parameters are honoured; this mirrors parseTotp in
// web/src/shared/totp/totp.ts.
func totpCodeAt(stored string, at time.Time) (string, error) {
	trimmed := strings.TrimSpace(stored)
	if trimmed == "" {
		return "", errors.New("item has no TOTP secret")
	}
	if !strings.HasPrefix(strings.ToLower(trimmed), "otpauth://") {
		return totp.GenerateCode(strings.ReplaceAll(trimmed, " ", ""), at)
	}
	key, err := otp.NewKeyFromURL(trimmed)
	if err != nil {
		return "", err
	}
	if key.Secret() == "" {
		return "", errors.New("otpauth URI missing secret")
	}
	return totp.GenerateCodeCustom(key.Secret(), at, totp.ValidateOpts{
		Period:    uint(key.Period()), //nolint:gosec // G115: period is a small positive integer from the URI
		Digits:    key.Digits(),
		Algorithm: key.Algorithm(),
	})
}

// totpSecondsRemaining reports how long the current code stays valid.
func totpSecondsRemaining(stored string, at time.Time) int {
	period := int64(30)
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(stored)), "otpauth://") {
		if key, err := otp.NewKeyFromURL(strings.TrimSpace(stored)); err == nil && key.Period() > 0 {
			period = int64(key.Period()) //nolint:gosec // G115: period is a small positive integer from the URI
		}
	}
	return int(period - at.Unix()%period)
}
