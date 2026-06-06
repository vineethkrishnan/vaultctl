// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/digest"
	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// prefsUserRepo embeds UserRepository so unused methods panic if hit; the prefs
// path only touches FindByID, SetLocale, and SetTimezone.
type prefsUserRepo struct {
	ports.UserRepository
	timezone string
	locale   string
}

func (r *prefsUserRepo) FindByID(_ context.Context, id user.ID) (user.User, error) {
	email, _ := user.NewEmail("a@b.com")
	return user.User{ID: id, Email: email, Locale: user.NormalizeLocale(r.locale), Timezone: user.NormalizeTimezone(r.timezone)}, nil
}
func (r *prefsUserRepo) SetLocale(_ context.Context, _ user.ID, locale string) error {
	r.locale = user.NormalizeLocale(locale)
	return nil
}
func (r *prefsUserRepo) SetTimezone(_ context.Context, _ user.ID, timezone string) error {
	r.timezone = user.NormalizeTimezone(timezone)
	return nil
}

// memDigestPrefs is an in-memory DigestPrefsRepository for the round-trip test.
// Like the real repo, the timezone is sourced from the users row.
type memDigestPrefs struct {
	pref  ports.DigestPref
	users *prefsUserRepo
}

func (m *memDigestPrefs) Get(context.Context, user.ID) (ports.DigestPref, error) {
	p := m.pref
	if m.users != nil {
		p.Timezone = user.NormalizeTimezone(m.users.timezone)
	}
	return p, nil
}
func (m *memDigestPrefs) Set(_ context.Context, _ user.ID, frequency string, schedule ports.DigestSchedule, nextRunAt *time.Time, _ time.Time) error {
	m.pref.Frequency = frequency
	m.pref.Schedule = schedule
	m.pref.NextRunAt = nextRunAt
	return nil
}
func (m *memDigestPrefs) Reschedule(context.Context, user.ID, *time.Time, time.Time) error {
	return nil
}
func (m *memDigestPrefs) ClaimDue(context.Context, time.Time) ([]ports.DueDigest, error) {
	return nil, nil
}
func (m *memDigestPrefs) SetLoginAlerts(_ context.Context, _ user.ID, enabled bool, _ time.Time) error {
	m.pref.LoginAlerts = enabled
	return nil
}
func (m *memDigestPrefs) LoginAlertsEnabled(context.Context, user.ID) (bool, error) {
	return m.pref.LoginAlerts, nil
}

func serveUpdatePrefs(t *testing.T, h *UserHandlers, body string) *httptest.ResponseRecorder {
	t.Helper()
	mw := middleware.RequireJWT(fakeTokenIssuer{userID: "user-42", role: "member"})
	handler := mw(http.HandlerFunc(h.HandleUpdateEmailPreferences))
	req := httptest.NewRequest(http.MethodPut, "/api/v1/users/me/email-preferences", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer dummy")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestUpdateEmailPreferences_ScheduleRoundTrip(t *testing.T) {
	now := time.Date(2026, 6, 1, 6, 0, 0, 0, time.UTC) // Monday 06:00 UTC
	users := &prefsUserRepo{timezone: "UTC", locale: "en"}
	prefs := &memDigestPrefs{pref: ports.DigestPref{Frequency: "off", LoginAlerts: true, Timezone: "UTC"}, users: users}
	h := &UserHandlers{
		Users:  users,
		Digest: &digest.Service{Prefs: prefs, Clock: ports.ClockFunc(func() time.Time { return now })},
	}

	body := `{"digestFrequency":"weekly","timezone":"Asia/Kolkata","schedWeekday":5,"schedHour":10,"schedMinute":0}`
	rec := serveUpdatePrefs(t, h, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var resp EmailPreferencesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.DigestFrequency != "weekly" {
		t.Errorf("frequency = %q, want weekly", resp.DigestFrequency)
	}
	if resp.Timezone != "Asia/Kolkata" {
		t.Errorf("timezone = %q, want Asia/Kolkata", resp.Timezone)
	}
	if resp.SchedWeekday == nil || *resp.SchedWeekday != 5 || resp.SchedHour == nil || *resp.SchedHour != 10 {
		t.Errorf("schedule weekday/hour not round-tripped: %+v", resp)
	}
	// Next Friday 10:00 IST = 04:30 UTC on 2026-06-05.
	want := time.Date(2026, 6, 5, 4, 30, 0, 0, time.UTC)
	if prefs.pref.NextRunAt == nil || !prefs.pref.NextRunAt.Equal(want) {
		t.Errorf("next_run_at = %v, want %v", prefs.pref.NextRunAt, want)
	}
}

func TestUpdateEmailPreferences_InvalidTimezoneRejected(t *testing.T) {
	prefs := &memDigestPrefs{pref: ports.DigestPref{Frequency: "off", LoginAlerts: true, Timezone: "UTC"}}
	users := &prefsUserRepo{timezone: "UTC", locale: "en"}
	h := &UserHandlers{Users: users, Digest: &digest.Service{Prefs: prefs, Clock: ports.RealClock()}}

	rec := serveUpdatePrefs(t, h, `{"timezone":"Mars/Phobos"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestUpdateEmailPreferences_WeekdayOnDailyRejected(t *testing.T) {
	prefs := &memDigestPrefs{pref: ports.DigestPref{Frequency: "off", LoginAlerts: true, Timezone: "UTC"}}
	users := &prefsUserRepo{timezone: "UTC", locale: "en"}
	h := &UserHandlers{Users: users, Digest: &digest.Service{Prefs: prefs, Clock: ports.RealClock()}}

	rec := serveUpdatePrefs(t, h, `{"digestFrequency":"daily","schedWeekday":3}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}
