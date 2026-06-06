// SPDX-License-Identifier: AGPL-3.0-or-later

package digest

import (
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
)

// Schedule is the user-chosen "when" for a digest, interpreted in the user's
// own timezone. Each field is a pointer: nil means the user did not pick that
// component. Which fields are relevant depends on the frequency:
//
//	daily     -> Hour, Minute
//	weekly    -> Weekday, Hour, Minute
//	monthly   -> Day, Hour, Minute
//	quarterly -> Day, Hour, Minute (every 3 months)
//	yearly    -> Month, Day, Hour, Minute
//
// A Schedule with every field nil is the "no schedule" case: the legacy generic
// next-run is used and the digest fires roughly one period after it is set.
type Schedule struct {
	Hour    *int // 0-23
	Minute  *int // 0-59
	Weekday *int // 0-6, Sunday=0 (matches time.Weekday)
	Day     *int // 1-31 (clamped to the month length)
	Month   *int // 1-12
}

// IsEmpty reports whether the user picked no schedule components at all.
func (s Schedule) IsEmpty() bool {
	return s.Hour == nil && s.Minute == nil && s.Weekday == nil && s.Day == nil && s.Month == nil
}

func ptrInt(v *int16) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

func ptrInt16(v *int) *int16 {
	if v == nil {
		return nil
	}
	n := int16(*v)
	return &n
}

// ScheduleFromPorts maps the persisted ports.DigestSchedule to a domain Schedule.
func ScheduleFromPorts(p ports.DigestSchedule) Schedule {
	return Schedule{
		Hour:    ptrInt(p.Hour),
		Minute:  ptrInt(p.Minute),
		Weekday: ptrInt(p.Weekday),
		Day:     ptrInt(p.Day),
		Month:   ptrInt(p.Month),
	}
}

// ToPorts maps a domain Schedule to the persisted ports.DigestSchedule.
func (s Schedule) ToPorts() ports.DigestSchedule {
	return ports.DigestSchedule{
		Hour:    ptrInt16(s.Hour),
		Minute:  ptrInt16(s.Minute),
		Weekday: ptrInt16(s.Weekday),
		Day:     ptrInt16(s.Day),
		Month:   ptrInt16(s.Month),
	}
}

// LoadLocation resolves an IANA timezone name to a *time.Location, treating an
// empty name as UTC. A non-nil error means the name is invalid.
func LoadLocation(timezone string) (*time.Location, error) {
	if timezone == "" {
		return time.UTC, nil
	}
	return time.LoadLocation(timezone)
}

func intInRange(field string, v *int, lo, hi int) error {
	if v == nil {
		return nil
	}
	if *v < lo || *v > hi {
		return domain.NewInvalid(field, "out of range")
	}
	return nil
}

// Validate checks every populated field against its absolute range and rejects
// fields that are not relevant to the given frequency. It does NOT require any
// field to be present: an empty schedule is valid (legacy generic next-run).
func (s Schedule) Validate(f Frequency) error {
	if err := intInRange("schedule.hour", s.Hour, 0, 23); err != nil {
		return err
	}
	if err := intInRange("schedule.minute", s.Minute, 0, 59); err != nil {
		return err
	}
	if err := intInRange("schedule.weekday", s.Weekday, 0, 6); err != nil {
		return err
	}
	if err := intInRange("schedule.day", s.Day, 1, 31); err != nil {
		return err
	}
	if err := intInRange("schedule.month", s.Month, 1, 12); err != nil {
		return err
	}

	allow := relevantFields(f)
	if s.Weekday != nil && !allow.weekday {
		return domain.NewInvalid("schedule.weekday", "not used for this frequency")
	}
	if s.Day != nil && !allow.day {
		return domain.NewInvalid("schedule.day", "not used for this frequency")
	}
	if s.Month != nil && !allow.month {
		return domain.NewInvalid("schedule.month", "not used for this frequency")
	}
	return nil
}

type fieldSet struct {
	weekday bool
	day     bool
	month   bool
}

func relevantFields(f Frequency) fieldSet {
	switch f {
	case Weekly:
		return fieldSet{weekday: true}
	case Monthly, Quarterly:
		return fieldSet{day: true}
	case Yearly:
		return fieldSet{day: true, month: true}
	default:
		return fieldSet{}
	}
}

func valueOr(v *int, fallback int) int {
	if v == nil {
		return fallback
	}
	return *v
}

// defaultHour is the time of day used when the user picks a frequency but no
// explicit time. Mirrors the UI default stated to the user (08:00 local).
const defaultHour = 8

// NextRun computes the next time the digest should fire after `from`, evaluating
// the schedule in `loc` (the user's timezone) and returning the result in UTC.
// It returns (zero, false) when the frequency is Off.
//
// When the schedule is empty it falls back to the legacy generic next-run
// (from + one period), preserving behaviour for users who only pick a frequency.
//
// Month-length is clamped: a Day of 31 in a 30-day month lands on the last day
// of that month. DST is handled implicitly by constructing wall-clock times in
// loc via time.Date.
func (f Frequency) NextRun(from time.Time, s Schedule, loc *time.Location) (time.Time, bool) {
	if f == Off {
		return time.Time{}, false
	}
	if loc == nil {
		loc = time.UTC
	}
	if s.IsEmpty() {
		return f.genericNextRun(from), true
	}

	local := from.In(loc)
	hour := valueOr(s.Hour, defaultHour)
	minute := valueOr(s.Minute, 0)

	switch f {
	case Daily:
		return nextDaily(local, hour, minute, loc), true
	case Weekly:
		return nextWeekly(local, valueOr(s.Weekday, int(time.Monday)), hour, minute, loc), true
	case Monthly:
		return nextByMonths(local, 1, valueOr(s.Day, 1), hour, minute, loc), true
	case Quarterly:
		return nextByMonths(local, 3, valueOr(s.Day, 1), hour, minute, loc), true
	case Yearly:
		return nextYearly(local, valueOr(s.Month, 1), valueOr(s.Day, 1), hour, minute, loc), true
	default:
		return time.Time{}, false
	}
}

func (f Frequency) genericNextRun(from time.Time) time.Time {
	switch f {
	case Daily:
		return from.AddDate(0, 0, 1)
	case Weekly:
		return from.AddDate(0, 0, 7)
	case Monthly:
		return from.AddDate(0, 1, 0)
	case Quarterly:
		return from.AddDate(0, 3, 0)
	case Yearly:
		return from.AddDate(1, 0, 0)
	default:
		return time.Time{}
	}
}

func nextDaily(local time.Time, hour, minute int, loc *time.Location) time.Time {
	candidate := time.Date(local.Year(), local.Month(), local.Day(), hour, minute, 0, 0, loc)
	if !candidate.After(local) {
		candidate = candidate.AddDate(0, 0, 1)
	}
	return candidate.UTC()
}

func nextWeekly(local time.Time, weekday, hour, minute int, loc *time.Location) time.Time {
	dayOffset := (weekday - int(local.Weekday()) + 7) % 7
	candidate := time.Date(local.Year(), local.Month(), local.Day(), hour, minute, 0, 0, loc).AddDate(0, 0, dayOffset)
	if !candidate.After(local) {
		candidate = candidate.AddDate(0, 0, 7)
	}
	return candidate.UTC()
}

// nextByMonths finds the next occurrence on `day` of a month, stepping by
// `step` months from the current month, clamping the day to the month length.
func nextByMonths(local time.Time, step, day, hour, minute int, loc *time.Location) time.Time {
	year, month := local.Year(), int(local.Month())
	for attempt := 0; attempt < 5; attempt++ {
		candidate := dateClamped(year, month, day, hour, minute, loc)
		if attempt > 0 || candidate.After(local) {
			return candidate.UTC()
		}
		month += step
		year, month = normalizeYearMonth(year, month)
	}
	return dateClamped(year, month, day, hour, minute, loc).UTC()
}

func nextYearly(local time.Time, month, day, hour, minute int, loc *time.Location) time.Time {
	year := local.Year()
	candidate := dateClamped(year, month, day, hour, minute, loc)
	if !candidate.After(local) {
		candidate = dateClamped(year+1, month, day, hour, minute, loc)
	}
	return candidate.UTC()
}

func normalizeYearMonth(year, month int) (int, int) {
	for month > 12 {
		month -= 12
		year++
	}
	return year, month
}

// dateClamped builds a wall-clock time in loc for the given y/m/d, clamping the
// day to the last day of the month (e.g. day 31 in February -> 28/29).
func dateClamped(year, month, day, hour, minute int, loc *time.Location) time.Time {
	last := daysInMonth(year, month)
	if day > last {
		day = last
	}
	return time.Date(year, time.Month(month), day, hour, minute, 0, 0, loc)
}

func daysInMonth(year, month int) int {
	return time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}
