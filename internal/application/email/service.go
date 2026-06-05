// SPDX-License-Identifier: AGPL-3.0-or-later

// Package email composes vaultctl's transactional messages (verification codes,
// security alerts, digests) and hands them to a ports.Mailer. It owns the
// shared branded layout so every message looks consistent; callers pass only
// the content. Composition lives here, in the application layer, so use cases
// depend on typed Send* methods rather than on HTML.
package email

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

// Service builds and sends vaultctl's transactional email.
type Service struct {
	Mailer  ports.Mailer
	BaseURL string // app origin, used for CTA links (VAULTCTL_BASE_URL)
}

// New constructs the composer.
func New(mailer ports.Mailer, baseURL string) *Service {
	return &Service{Mailer: mailer, BaseURL: strings.TrimRight(baseURL, "/")}
}

// Enabled reports whether real delivery is configured.
func (s *Service) Enabled() bool { return s.Mailer != nil && s.Mailer.Enabled() }

// content is the structured input the shared layout renders into text + HTML.
type content struct {
	heading  string
	intro    []string // paragraphs before the focal element
	code     string   // optional: a large one-time code block
	ctaLabel string   // optional: a button
	ctaURL   string
	outro    []string // paragraphs after
	signoff  string
}

// SendVerificationCode emails a signup verification code.
func (s *Service) SendVerificationCode(ctx context.Context, to, code string, ttl time.Duration) error {
	c := content{
		heading: "Confirm your email",
		intro: []string{
			"Enter this code in vaultctl to confirm your email address and activate your account.",
		},
		code: code,
		outro: []string{
			fmt.Sprintf("The code expires in %s. If you didn't create a vaultctl account, you can ignore this email.", humanizeDuration(ttl)),
		},
	}
	text, htmlBody := s.render(c)
	return s.Mailer.Send(ctx, ports.Email{
		To:      to,
		Subject: "Your vaultctl verification code",
		Text:    text,
		HTML:    htmlBody,
	})
}

// SendLoginAlert emails a security alert about a sign-in from a new device or
// network. Copy is strictly factual: it states only what the server knows
// (device label, IP, time) and never asserts a location it cannot verify.
func (s *Service) SendLoginAlert(ctx context.Context, to, reason, deviceLabel, ipAddress string, when time.Time) error {
	what := "A new sign-in"
	switch reason {
	case "new_device":
		what = "A sign-in from a new device"
	case "new_network":
		what = "A sign-in from a new network"
	}
	ip := ipAddress
	if ip == "" {
		ip = "unknown"
	}
	c := content{
		heading: "New sign-in to your vault",
		intro: []string{
			what + " just happened on your vaultctl account.",
			"Device: " + deviceLabel,
			"When: " + when.UTC().Format("2 Jan 2006, 15:04 MST"),
			"IP address: " + ip,
		},
		ctaLabel: "Review your sessions",
		ctaURL:   s.BaseURL + "/settings",
		outro: []string{
			"If this was you, no action is needed.",
			"If you don't recognise it, change your master password and sign out other sessions right away.",
		},
	}
	text, htmlBody := s.render(c)
	return s.Mailer.Send(ctx, ports.Email{To: to, Subject: "New sign-in to your vaultctl account", Text: text, HTML: htmlBody})
}

// SendDigest emails an activity summary for the given period (e.g. "weekly").
func (s *Service) SendDigest(ctx context.Context, to, period string, a ports.DigestActivity) error {
	lines := []string{
		fmt.Sprintf("Sign-ins: %d", a.Logins),
		fmt.Sprintf("New devices or networks: %d", a.NewDevices),
		fmt.Sprintf("Items added: %d", a.ItemsAdded),
	}
	outro := []string{}
	if a.StaleLogins > 0 {
		outro = append(outro, fmt.Sprintf("%d login%s haven't been updated in over a year. Consider rotating those passwords.", a.StaleLogins, plural(a.StaleLogins)))
	}
	outro = append(outro, "You can change how often you receive this in vaultctl settings.")

	c := content{
		heading:  "Your vaultctl " + period + " digest",
		intro:    append([]string{"Here's what happened on your account:"}, lines...),
		ctaLabel: "Open vaultctl",
		ctaURL:   s.BaseURL,
		outro:    outro,
	}
	text, htmlBody := s.render(c)
	return s.Mailer.Send(ctx, ports.Email{
		To:      to,
		Subject: "Your vaultctl " + period + " digest",
		Text:    text,
		HTML:    htmlBody,
	})
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func humanizeDuration(d time.Duration) string {
	if d >= time.Hour && d%time.Hour == 0 {
		h := int(d / time.Hour)
		if h == 1 {
			return "1 hour"
		}
		return fmt.Sprintf("%d hours", h)
	}
	m := int(d / time.Minute)
	if m == 1 {
		return "1 minute"
	}
	return fmt.Sprintf("%d minutes", m)
}
