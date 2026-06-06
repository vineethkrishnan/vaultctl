// SPDX-License-Identifier: AGPL-3.0-or-later

package email

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

type captureMailer struct{ last ports.Email }

func (m *captureMailer) Send(_ context.Context, msg ports.Email) error {
	m.last = msg
	return nil
}
func (m *captureMailer) Enabled() bool { return true }

func newService() (*Service, *captureMailer) {
	mailer := &captureMailer{}
	return New(mailer, "https://vault.example.com/"), mailer
}

func TestSendVerificationCode_LocalizedSubject(t *testing.T) {
	svc, mailer := newService()
	ctx := context.Background()

	if err := svc.SendVerificationCode(ctx, "a@b.com", "en", "123456", 15*time.Minute); err != nil {
		t.Fatal(err)
	}
	en := mailer.last
	if err := svc.SendVerificationCode(ctx, "a@b.com", "de", "123456", 15*time.Minute); err != nil {
		t.Fatal(err)
	}
	de := mailer.last

	if en.Subject != "Your vaultctl verification code" {
		t.Errorf("en subject = %q", en.Subject)
	}
	if de.Subject != "Ihr vaultctl-Bestätigungscode" {
		t.Errorf("de subject = %q", de.Subject)
	}
	if en.Subject == de.Subject {
		t.Fatal("en and de subjects must differ")
	}
	if !strings.Contains(de.Text, "15 Minuten") {
		t.Errorf("de body should localize the TTL words, got %q", de.Text)
	}
	if !strings.Contains(en.Text, "15 minutes") {
		t.Errorf("en body should keep English TTL words, got %q", en.Text)
	}
}

func TestSendLoginAlert_LocalizedSubjectAndFooter(t *testing.T) {
	svc, mailer := newService()
	ctx := context.Background()
	when := time.Date(2026, 6, 6, 9, 0, 0, 0, time.UTC)

	if err := svc.SendLoginAlert(ctx, "a@b.com", "de", "new_device", "Chrome on macOS", "203.0.113.0", when); err != nil {
		t.Fatal(err)
	}
	de := mailer.last
	if de.Subject != "Neue Anmeldung bei Ihrem vaultctl-Konto" {
		t.Errorf("de login subject = %q", de.Subject)
	}
	if !strings.Contains(de.HTML, "Sie erhalten diese E-Mail") {
		t.Errorf("de footer not localized in HTML, got %q", de.HTML)
	}
	if !strings.Contains(de.Text, "Gerät: Chrome on macOS") {
		t.Errorf("de device label not localized, got %q", de.Text)
	}
}

func TestSendDigest_LocalizedPeriod(t *testing.T) {
	svc, mailer := newService()
	ctx := context.Background()
	activity := ports.DigestActivity{Logins: 3, ItemsAdded: 2}

	if err := svc.SendDigest(ctx, "a@b.com", "en", "weekly", activity); err != nil {
		t.Fatal(err)
	}
	if got := mailer.last.Subject; got != "Your vaultctl weekly digest" {
		t.Errorf("en digest subject = %q", got)
	}
	if err := svc.SendDigest(ctx, "a@b.com", "de", "weekly", activity); err != nil {
		t.Fatal(err)
	}
	if got := mailer.last.Subject; got != "Ihre vaultctl-Zusammenfassung (wöchentlich)" {
		t.Errorf("de digest subject = %q", got)
	}
}

func TestCatalogFallsBackToEnglish(t *testing.T) {
	svc, mailer := newService()
	if err := svc.SendVerificationCode(context.Background(), "a@b.com", "fr", "123456", 15*time.Minute); err != nil {
		t.Fatal(err)
	}
	if mailer.last.Subject != "Your vaultctl verification code" {
		t.Errorf("unknown locale should fall back to English, got %q", mailer.last.Subject)
	}
}
