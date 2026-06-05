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
