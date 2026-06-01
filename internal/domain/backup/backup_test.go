// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"testing"
	"time"
)

func TestFrequencyNext(t *testing.T) {
	base := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		freq Frequency
		want time.Time
	}{
		{FrequencyDaily, base.AddDate(0, 0, 1)},
		{FrequencyWeekly, base.AddDate(0, 0, 7)},
		{FrequencyOff, time.Time{}},
	}
	for _, c := range cases {
		if got := c.freq.Next(base); !got.Equal(c.want) {
			t.Errorf("%s.Next = %v, want %v", c.freq, got, c.want)
		}
	}
}

func TestParseProviderAndFrequency(t *testing.T) {
	if _, err := ParseProvider("local"); err != nil {
		t.Errorf("ParseProvider(local): %v", err)
	}
	if _, err := ParseProvider("ftp"); err == nil {
		t.Error("ParseProvider(ftp) should fail")
	}
	if _, err := ParseFrequency("daily"); err != nil {
		t.Errorf("ParseFrequency(daily): %v", err)
	}
	if _, err := ParseFrequency("hourly"); err == nil {
		t.Error("ParseFrequency(hourly) should fail")
	}
}

func TestDestinationValidate(t *testing.T) {
	valid := Destination{Provider: ProviderLocal, Label: "Local", Frequency: FrequencyDaily, RetentionKeep: 7}
	if err := valid.Validate(); err != nil {
		t.Errorf("valid destination rejected: %v", err)
	}
	noLabel := valid
	noLabel.Label = ""
	if err := noLabel.Validate(); err == nil {
		t.Error("missing label should fail validation")
	}
	noRetention := valid
	noRetention.RetentionKeep = 0
	if err := noRetention.Validate(); err == nil {
		t.Error("zero retention should fail validation")
	}
}
