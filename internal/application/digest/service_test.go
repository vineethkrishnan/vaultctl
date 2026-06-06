// SPDX-License-Identifier: AGPL-3.0-or-later

package digest

import (
	"context"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func ptr(n int) *int { return &n }

func mustLoad(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("load %s: %v", name, err)
	}
	return loc
}

// TestNextRun_NoSchedule keeps the legacy generic next-run for users who pick
// only a frequency (backward compatible).
func TestNextRun_NoSchedule(t *testing.T) {
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
		got, ok := c.f.NextRun(from, Schedule{}, time.UTC)
		if ok != c.ok || (ok && !got.Equal(c.want)) {
			t.Errorf("%s.NextRun = (%v,%v), want (%v,%v)", c.f, got, ok, c.want, c.ok)
		}
	}
}

// TestNextRun_DailyInTimezone checks the chosen wall-clock time is interpreted
// in the user's zone and returned in UTC.
func TestNextRun_DailyInTimezone(t *testing.T) {
	kolkata := mustLoad(t, "Asia/Kolkata") // UTC+5:30, no DST
	// 06:00 UTC on the 15th. User wants 09:00 Kolkata = 03:30 UTC, already passed,
	// so the next 09:00 IST is on the 16th = 03:30 UTC on the 16th.
	from := time.Date(2026, 3, 15, 6, 0, 0, 0, time.UTC)
	got, ok := Daily.NextRun(from, Schedule{Hour: ptr(9), Minute: ptr(0)}, kolkata)
	want := time.Date(2026, 3, 16, 3, 30, 0, 0, time.UTC)
	if !ok || !got.Equal(want) {
		t.Fatalf("daily IST = %v (ok=%v), want %v", got, ok, want)
	}

	// Same day, before the chosen time: 09:00 IST = 03:30 UTC is still ahead.
	from2 := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
	got2, _ := Daily.NextRun(from2, Schedule{Hour: ptr(9)}, kolkata)
	want2 := time.Date(2026, 3, 15, 3, 30, 0, 0, time.UTC)
	if !got2.Equal(want2) {
		t.Fatalf("daily IST same-day = %v, want %v", got2, want2)
	}
}

// TestNextRun_WeeklyPicksWeekday verifies weekday selection in-zone.
func TestNextRun_WeeklyPicksWeekday(t *testing.T) {
	loc := time.UTC
	// 2026-06-01 is a Monday. Want Friday (5) 10:00.
	from := time.Date(2026, 6, 1, 12, 0, 0, 0, loc)
	got, _ := Weekly.NextRun(from, Schedule{Weekday: ptr(int(time.Friday)), Hour: ptr(10)}, loc)
	want := time.Date(2026, 6, 5, 10, 0, 0, 0, loc)
	if !got.Equal(want) {
		t.Fatalf("weekly = %v, want %v", got, want)
	}

	// When the chosen weekday is today but the time already passed, roll a week.
	fromMon := time.Date(2026, 6, 1, 23, 0, 0, 0, loc)
	gotMon, _ := Weekly.NextRun(fromMon, Schedule{Weekday: ptr(int(time.Monday)), Hour: ptr(8)}, loc)
	wantMon := time.Date(2026, 6, 8, 8, 0, 0, 0, loc)
	if !gotMon.Equal(wantMon) {
		t.Fatalf("weekly same-weekday-passed = %v, want %v", gotMon, wantMon)
	}
}

// TestNextRun_MonthlyClampsDay checks day 31 in a 30-day month lands on the last
// day, and that the next month is chosen when this month's date passed.
func TestNextRun_MonthlyClampsDay(t *testing.T) {
	loc := time.UTC
	// From mid-April, want day 31 -> April has 30 days -> April 30 (still ahead).
	from := time.Date(2026, 4, 15, 0, 0, 0, 0, loc)
	got, _ := Monthly.NextRun(from, Schedule{Day: ptr(31), Hour: ptr(9)}, loc)
	want := time.Date(2026, 4, 30, 9, 0, 0, 0, loc)
	if !got.Equal(want) {
		t.Fatalf("monthly clamp = %v, want %v", got, want)
	}

	// After April 30 passed, the next is May 31.
	fromLate := time.Date(2026, 4, 30, 23, 0, 0, 0, loc)
	gotLate, _ := Monthly.NextRun(fromLate, Schedule{Day: ptr(31), Hour: ptr(9)}, loc)
	wantLate := time.Date(2026, 5, 31, 9, 0, 0, 0, loc)
	if !gotLate.Equal(wantLate) {
		t.Fatalf("monthly next month = %v, want %v", gotLate, wantLate)
	}

	// February clamp: from late January, day 31 -> Feb 28 in 2026 (not a leap year).
	fromJan := time.Date(2026, 1, 31, 23, 0, 0, 0, loc)
	gotFeb, _ := Monthly.NextRun(fromJan, Schedule{Day: ptr(31), Hour: ptr(9)}, loc)
	wantFeb := time.Date(2026, 2, 28, 9, 0, 0, 0, loc)
	if !gotFeb.Equal(wantFeb) {
		t.Fatalf("monthly Feb clamp = %v, want %v", gotFeb, wantFeb)
	}
}

// TestNextRun_Quarterly steps by three months.
func TestNextRun_Quarterly(t *testing.T) {
	loc := time.UTC
	from := time.Date(2026, 1, 20, 0, 0, 0, 0, loc) // day 15 of Jan already passed
	got, _ := Quarterly.NextRun(from, Schedule{Day: ptr(15), Hour: ptr(9)}, loc)
	want := time.Date(2026, 4, 15, 9, 0, 0, 0, loc)
	if !got.Equal(want) {
		t.Fatalf("quarterly = %v, want %v", got, want)
	}
}

// TestNextRun_Yearly picks month + day.
func TestNextRun_Yearly(t *testing.T) {
	loc := time.UTC
	from := time.Date(2026, 6, 1, 0, 0, 0, 0, loc)
	got, _ := Yearly.NextRun(from, Schedule{Month: ptr(3), Day: ptr(10), Hour: ptr(8)}, loc)
	want := time.Date(2027, 3, 10, 8, 0, 0, 0, loc) // March 10 already passed this year
	if !got.Equal(want) {
		t.Fatalf("yearly = %v, want %v", got, want)
	}
}

// TestNextRun_DSTSpringForward verifies a wall-clock time across a DST boundary
// resolves to the correct UTC instant via the IANA db.
func TestNextRun_DSTSpringForward(t *testing.T) {
	berlin := mustLoad(t, "Europe/Berlin")
	// Berlin springs forward 2026-03-29 02:00 -> 03:00 (CET +1 -> CEST +2).
	// A daily digest at 09:00 local: on 2026-03-28 09:00 CET = 08:00 UTC;
	// on 2026-03-29 09:00 CEST = 07:00 UTC.
	from := time.Date(2026, 3, 28, 12, 0, 0, 0, time.UTC) // past the 28th's 08:00 UTC
	got, _ := Daily.NextRun(from, Schedule{Hour: ptr(9)}, berlin)
	want := time.Date(2026, 3, 29, 7, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("DST daily = %v, want %v", got, want)
	}
}

func TestSchedule_Validate(t *testing.T) {
	cases := []struct {
		name    string
		f       Frequency
		s       Schedule
		wantErr bool
	}{
		{"daily ok", Daily, Schedule{Hour: ptr(8), Minute: ptr(30)}, false},
		{"hour out of range", Daily, Schedule{Hour: ptr(24)}, true},
		{"minute out of range", Daily, Schedule{Minute: ptr(60)}, true},
		{"weekday on daily rejected", Daily, Schedule{Weekday: ptr(2)}, true},
		{"weekly weekday ok", Weekly, Schedule{Weekday: ptr(6)}, false},
		{"weekday out of range", Weekly, Schedule{Weekday: ptr(7)}, true},
		{"day on weekly rejected", Weekly, Schedule{Day: ptr(5)}, true},
		{"monthly day ok", Monthly, Schedule{Day: ptr(31)}, false},
		{"day out of range", Monthly, Schedule{Day: ptr(32)}, true},
		{"month on monthly rejected", Monthly, Schedule{Month: ptr(3)}, true},
		{"yearly month+day ok", Yearly, Schedule{Month: ptr(12), Day: ptr(25)}, false},
		{"month out of range", Yearly, Schedule{Month: ptr(13)}, true},
		{"empty always ok", Yearly, Schedule{}, false},
	}
	for _, c := range cases {
		err := c.s.Validate(c.f)
		if (err != nil) != c.wantErr {
			t.Errorf("%s: Validate err=%v, wantErr=%v", c.name, err, c.wantErr)
		}
	}
}

type fakeDigestPrefs struct {
	due    []ports.DueDigest
	marked map[user.ID]*time.Time
}

func (f *fakeDigestPrefs) Get(context.Context, user.ID) (ports.DigestPref, error) {
	return ports.DigestPref{Frequency: "off", Timezone: "UTC"}, nil
}
func (f *fakeDigestPrefs) Set(context.Context, user.ID, string, ports.DigestSchedule, *time.Time, time.Time) error {
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
	// Mirror the real repo: the SQL claim advances next_run_at by the fixed
	// interval. RunDue then corrects it via Reschedule for scheduled rows.
	for _, d := range f.due {
		if next, ok := Frequency(d.Frequency).NextRun(now, Schedule{}, time.UTC); ok {
			n := next
			f.marked[d.UserID] = &n
		}
	}
	return f.due, nil
}
func (f *fakeDigestPrefs) Reschedule(_ context.Context, userID user.ID, nextRunAt *time.Time, _ time.Time) error {
	if f.marked == nil {
		f.marked = map[user.ID]*time.Time{}
	}
	f.marked[userID] = nextRunAt
	return nil
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
	prefs := &fakeDigestPrefs{due: []ports.DueDigest{{UserID: "u1", Email: "a@b.com", Locale: "de", Frequency: "weekly", Timezone: "UTC"}}}
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
	// No schedule set: the row keeps the legacy fixed-interval next run (+7d).
	next := prefs.marked["u1"]
	if next == nil || !next.Equal(now.AddDate(0, 0, 7)) {
		t.Fatalf("expected next run +7d, got %v", next)
	}
}

func TestRunDue_RescheduleUsesSchedule(t *testing.T) {
	now := time.Date(2026, 6, 1, 6, 0, 0, 0, time.UTC) // Monday 06:00 UTC
	prefs := &fakeDigestPrefs{due: []ports.DueDigest{{
		UserID: "u1", Email: "a@b.com", Frequency: "weekly", Timezone: "UTC",
		Schedule: ports.DigestSchedule{Weekday: i16(int(time.Friday)), Hour: i16(10)},
	}}}
	sender := &capturingDigestSender{}
	svc := &Service{
		Prefs:    prefs,
		Activity: fakeActivity{ports.DigestActivity{Logins: 1}},
		Sender:   sender,
		Clock:    ports.ClockFunc(func() time.Time { return now }),
	}
	if err := svc.RunDue(context.Background()); err != nil {
		t.Fatal(err)
	}
	next := prefs.marked["u1"]
	want := time.Date(2026, 6, 5, 10, 0, 0, 0, time.UTC) // next Friday 10:00
	if next == nil || !next.Equal(want) {
		t.Fatalf("expected scheduled next run %v, got %v", want, next)
	}
}

func i16(n int) *int16 { v := int16(n); return &v }

func TestRunDue_EmptySkipsSendButReschedules(t *testing.T) {
	now := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	prefs := &fakeDigestPrefs{due: []ports.DueDigest{{UserID: "u1", Email: "a@b.com", Frequency: "daily", Timezone: "UTC"}}}
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
