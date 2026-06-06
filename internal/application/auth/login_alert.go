// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"strings"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// Reasons a login alert fires.
const (
	LoginReasonNewDevice  = "new_device"
	LoginReasonNewNetwork = "new_network"
)

// LoginAlertSender delivers the security alert. *email.Service satisfies it.
type LoginAlertSender interface {
	SendLoginAlert(ctx context.Context, to, locale, reason, deviceLabel, ipAddress string, when time.Time) error
}

// LoginAlertPrefs reports a user's opt-in for sign-in alert emails.
// *digest.Service satisfies it via LoginAlerts.
type LoginAlertPrefs interface {
	LoginAlerts(ctx context.Context, userID user.ID) (bool, error)
}

// NotifyLogin records the login's device + network and, when new for the user,
// sends a single security alert. It never alerts on the user's first recorded
// login (the signup device) and skips entirely when the user-agent is missing,
// so it does not fabricate a "new device" it cannot describe.
type NotifyLogin struct {
	Known  ports.KnownLoginRepository
	HMAC   ports.HMACer
	Clock  ports.Clock
	Sender LoginAlertSender
	// NewNetworkEnabled controls the new-network alert. Off by default because
	// the network is a /24-anonymised IP that roams for mobile users; the
	// new-device alert is always active regardless.
	NewNetworkEnabled bool
	// Prefs gates sending on the user's opt-out. Nil means always-on.
	Prefs LoginAlertPrefs
}

// Execute classifies the login and alerts if warranted. Best-effort: callers
// run it off the request path and only log failures. Novelty is decided from a
// single atomic upsert so concurrent logins can't double-alert.
func (uc *NotifyLogin) Execute(ctx context.Context, userID user.ID, to, locale, deviceName, userAgent, ipAddress string) error {
	if uc.Sender == nil || strings.TrimSpace(userAgent) == "" || to == "" {
		return nil
	}
	label := DescribeUserAgent(userAgent)
	fingerprint := uc.deviceFingerprint(label, deviceName)

	now := uc.Clock.Now()
	obs, err := uc.Known.Observe(ctx, userID, fingerprint, ipAddress, label, now)
	if err != nil {
		return err
	}

	// First login on record is the device the account was created on - never
	// alert on it (that would be a false positive on every brand-new account).
	if !obs.AnySeen {
		return nil
	}
	// Only the call that actually inserted this row may alert, so a concurrent
	// racing login on the same (device, network) stays silent.
	if !obs.Inserted {
		return nil
	}

	if uc.Prefs != nil {
		enabled, perr := uc.Prefs.LoginAlerts(ctx, userID)
		if perr != nil {
			return perr
		}
		if !enabled {
			return nil
		}
	}

	reason := ""
	switch {
	case !obs.DeviceSeen:
		reason = LoginReasonNewDevice
	case uc.NewNetworkEnabled:
		reason = LoginReasonNewNetwork
	default:
		return nil
	}
	return uc.Sender.SendLoginAlert(ctx, to, locale, reason, label, ipAddress, now)
}

// deviceFingerprint folds the client-provided device name into the HMAC so two
// distinct devices on the same browser/OS family don't collide on one
// fingerprint. The name is normalised so trivial whitespace changes are stable.
func (uc *NotifyLogin) deviceFingerprint(label, deviceName string) []byte {
	name := strings.ToLower(strings.TrimSpace(deviceName))
	return uc.HMAC.HashString("login-device:" + label + "\x00" + name)
}

// DescribeUserAgent reduces a user-agent string to a coarse, stable label like
// "Chrome on macOS". Versions are intentionally dropped so a routine browser
// update is not mistaken for a new device.
func DescribeUserAgent(ua string) string {
	browser := detectBrowser(ua)
	os := detectOS(ua)
	switch {
	case browser != "" && os != "":
		return browser + " on " + os
	case browser != "":
		return browser
	case os != "":
		return os
	default:
		return "an unrecognised device"
	}
}

func detectOS(ua string) string {
	switch {
	case strings.Contains(ua, "Windows"):
		return "Windows"
	case strings.Contains(ua, "iPhone"), strings.Contains(ua, "iPad"):
		return "iOS"
	case strings.Contains(ua, "Mac OS X"), strings.Contains(ua, "Macintosh"):
		return "macOS"
	case strings.Contains(ua, "Android"):
		return "Android"
	case strings.Contains(ua, "Linux"):
		return "Linux"
	default:
		return ""
	}
}

func detectBrowser(ua string) string {
	switch {
	case strings.Contains(ua, "Edg/"):
		return "Edge"
	case strings.Contains(ua, "OPR/"), strings.Contains(ua, "Opera"):
		return "Opera"
	case strings.Contains(ua, "Firefox/"):
		return "Firefox"
	case strings.Contains(ua, "Chrome/"):
		return "Chrome"
	case strings.Contains(ua, "Safari/"):
		return "Safari"
	default:
		return ""
	}
}
