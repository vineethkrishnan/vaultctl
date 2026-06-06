// SPDX-License-Identifier: AGPL-3.0-or-later

package digest

import (
	"context"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func TestFrequencyNextRun(t *testing.T) {
	from := time.Date(2026, 1, 15, 9, 0, 0, 0, time.UTC)
	cases := []struct {
		f    Frequency
		want time.Time
		ok   bool
	}{
		{Daily, from.AddDate(0, 0, 1), true},
		{Weekly, from.AddDate(0, 0, 7), true},
		{Monthly, from.AddDate(0, 1, 0), true},
		{Quarterly, from.AddDate(0, 3, 0), true},
		{Yearly, from.AddDate(1, 0, 0), true},
		{Off, time.Time{}, false},
	}
	for _, c := range cases {
		got, ok := c.f.NextRun(from)
		if ok != c.ok || (ok && !got.Equal(c.want)) {
			t.Errorf("%s.NextRun = (%v,%v), want (%v,%v)", c.f, got, ok, c.want, c.ok)
		}
	}
}

type fakeDigestPrefs struct {
	due    []ports.DueDigest
	marked map[user.ID]*time.Time
}

func (f *fakeDigestPrefs) Get(context.Context, user.ID) (ports.DigestPref, error) {
	return ports.DigestPref{Frequency: "off"}, nil
}
func (f *fakeDigestPrefs) Set(context.Context, user.ID, string, *time.Time, time.Time) error {
	return nil
}
func (f *fakeDigestPrefs) SetLoginAlerts(context.Context, user.ID, bool, time.Time) error {
	return nil
}
func (f *fakeDigestPrefs) LoginAlertsEnabled(context.Context, user.ID) (bool, error) {
	return true, nil
}
func (f *fakeDigestPrefs) ClaimDue(_ context.Context, now time.Time) ([]ports.DueDigest, error) {
	if f.marked == nil {
		f.marked = map[user.ID]*time.Time{}
	}
	// Mirror the real repo: claim each due row by advancing its next run before
	// returning it (the send happens after the claim).
	for _, d := range f.due {
		if next, ok := Frequency(d.Frequency).NextRun(now); ok {
			n := next
			f.marked[d.UserID] = &n
		}
	}
	return f.due, nil
}

type fakeActivity struct{ a ports.DigestActivity }

func (f fakeActivity) Summary(context.Context, user.ID, time.Time, time.Time) (ports.DigestActivity, error) {
	return f.a, nil
}

type capturingDigestSender struct {
	sent    []string
	locales []string
}

func (s *capturingDigestSender) SendDigest(_ context.Context, to, locale, _ string, _ ports.DigestActivity) error {
	s.sent = append(s.sent, to)
	s.locales = append(s.locales, locale)
	return nil
}

func TestRunDue_SendsAndReschedules(t *testing.T) {
	now := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	prefs := &fakeDigestPrefs{due: []ports.DueDigest{{UserID: "u1", Email: "a@b.com", Locale: "de", Frequency: "weekly"}}}
	sender := &capturingDigestSender{}
	svc := &Service{
		Prefs:    prefs,
		Activity: fakeActivity{ports.DigestActivity{Logins: 3, ItemsAdded: 2}},
		Sender:   sender,
		Clock:    ports.ClockFunc(func() time.Time { return now }),
	}
	if err := svc.RunDue(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(sender.sent) != 1 || sender.sent[0] != "a@b.com" {
		t.Fatalf("expected one send to a@b.com, got %v", sender.sent)
	}
	if len(sender.locales) != 1 || sender.locales[0] != "de" {
		t.Fatalf("expected the user's locale threaded to the send, got %v", sender.locales)
	}
	next := prefs.marked["u1"]
	if next == nil || !next.Equal(now.AddDate(0, 0, 7)) {
		t.Fatalf("expected next run +7d, got %v", next)
	}
}

func TestRunDue_EmptySkipsSendButReschedules(t *testing.T) {
	now := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	prefs := &fakeDigestPrefs{due: []ports.DueDigest{{UserID: "u1", Email: "a@b.com", Frequency: "daily"}}}
	sender := &capturingDigestSender{}
	svc := &Service{
		Prefs:    prefs,
		Activity: fakeActivity{ports.DigestActivity{}},
		Sender:   sender,
		Clock:    ports.ClockFunc(func() time.Time { return now }),
	}
	if err := svc.RunDue(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(sender.sent) != 0 {
		t.Fatalf("empty digest should not send, got %v", sender.sent)
	}
	if prefs.marked["u1"] == nil {
		t.Fatal("empty digest should still reschedule")
	}
}
