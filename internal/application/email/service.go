// SPDX-License-Identifier: AGPL-3.0-or-later

// Package email composes vaultctl's transactional messages (verification codes,
// security alerts, digests) and hands them to a ports.Mailer. It owns the
// shared branded layout so every message looks consistent; callers pass only
// the content and the recipient's locale. Composition lives here, in the
// application layer, so use cases depend on typed Send* methods rather than on
// HTML or translation tables.
package email

import (
	"context"
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
	footer   string // localized layout footer
}

// SendVerificationCode emails a signup verification code in the user's locale.
func (s *Service) SendVerificationCode(ctx context.Context, to, locale, code string, ttl time.Duration) error {
	cat := catalogFor(locale)
	c := content{
		heading: cat.verifyHeading,
		intro:   []string{cat.verifyIntro},
		code:    code,
		outro:   []string{cat.verifyOutro(cat.humanizeDuration(ttl))},
		signoff: cat.signoff,
		footer:  cat.footer,
	}
	text, htmlBody := s.render(c)
	return s.Mailer.Send(ctx, ports.Email{
		To:      to,
		Subject: cat.verifySubject,
		Text:    text,
		HTML:    htmlBody,
	})
}

// SendLoginAlert emails a security alert about a sign-in from a new device or
// network, in the user's locale. Copy is strictly factual: it states only what
// the server knows (device label, IP, time) and never asserts a location it
// cannot verify.
func (s *Service) SendLoginAlert(ctx context.Context, to, locale, reason, deviceLabel, ipAddress string, when time.Time) error {
	cat := catalogFor(locale)
	what := cat.loginNewSignin
	switch reason {
	case "new_device":
		what = cat.loginNewDevice
	case "new_network":
		what = cat.loginNewNetwork
	}
	ip := ipAddress
	if ip == "" {
		ip = cat.loginUnknownIP
	}
	c := content{
		heading: cat.loginHeading,
		intro: []string{
			cat.loginHappened(what),
			cat.loginDeviceLabel + deviceLabel,
			cat.loginWhenLabel + when.UTC().Format("2 Jan 2006, 15:04 MST"),
			cat.loginIPLabel + ip,
		},
		ctaLabel: cat.loginCTA,
		ctaURL:   s.BaseURL + "/settings",
		outro:    []string{cat.loginOutroOK, cat.loginOutroAct},
		signoff:  cat.signoff,
		footer:   cat.footer,
	}
	text, htmlBody := s.render(c)
	return s.Mailer.Send(ctx, ports.Email{To: to, Subject: cat.loginSubject, Text: text, HTML: htmlBody})
}

// SendDigest emails an activity summary for the given period (a frequency key
// like "weekly") in the user's locale.
func (s *Service) SendDigest(ctx context.Context, to, locale, period string, a ports.DigestActivity) error {
	cat := catalogFor(locale)
	localizedPeriod := cat.period(period)
	lines := []string{
		cat.digestLogins(a.Logins),
		cat.digestDevices(a.NewDevices),
		cat.digestItems(a.ItemsAdded),
	}
	outro := []string{}
	if a.StaleLogins > 0 {
		outro = append(outro, cat.digestStale(a.StaleLogins))
	}
	outro = append(outro, cat.digestSettings)

	c := content{
		heading:  cat.digestHeading(localizedPeriod),
		intro:    append([]string{cat.digestIntro}, lines...),
		ctaLabel: cat.digestCTA,
		ctaURL:   s.BaseURL,
		outro:    outro,
		signoff:  cat.signoff,
		footer:   cat.footer,
	}
	text, htmlBody := s.render(c)
	return s.Mailer.Send(ctx, ports.Email{
		To:      to,
		Subject: cat.digestSubject(localizedPeriod),
		Text:    text,
		HTML:    htmlBody,
	})
}
