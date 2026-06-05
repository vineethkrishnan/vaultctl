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
	SendLoginAlert(ctx context.Context, to, reason, deviceLabel, ipAddress string, when time.Time) error
}

// NotifyLogin records the login's device + network and, when either is new for
// the user, sends a single security alert. It never alerts on the user's first
// recorded login (the signup device) and skips entirely when the user-agent is
// missing, so it does not fabricate a "new device" it cannot describe.
type NotifyLogin struct {
	Known  ports.KnownLoginRepository
	HMAC   ports.HMACer
	Clock  ports.Clock
	Sender LoginAlertSender
}

// Execute classifies the login and alerts if warranted. Best-effort: callers
// run it off the request path and only log failures.
func (uc *NotifyLogin) Execute(ctx context.Context, userID user.ID, to, userAgent, ipAddress string) error {
	if uc.Sender == nil || strings.TrimSpace(userAgent) == "" || to == "" {
		return nil
	}
	label := DescribeUserAgent(userAgent)
	fingerprint := uc.HMAC.HashString("login-device:" + label)

	deviceSeen, networkSeen, anySeen, err := uc.Known.Lookup(ctx, userID, fingerprint, ipAddress)
	if err != nil {
		return err
	}
	now := uc.Clock.Now()
	if err := uc.Known.Record(ctx, userID, fingerprint, ipAddress, label, now); err != nil {
		return err
	}

	// First login on record is the device the account was created on - never
	// alert on it (that would be a false positive on every brand-new account).
	if !anySeen {
		return nil
	}

	reason := ""
	switch {
	case !deviceSeen:
		reason = LoginReasonNewDevice
	case !networkSeen:
		reason = LoginReasonNewNetwork
	default:
		return nil
	}
	return uc.Sender.SendLoginAlert(ctx, to, reason, label, ipAddress, now)
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
