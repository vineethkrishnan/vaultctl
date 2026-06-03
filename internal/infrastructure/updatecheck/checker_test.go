// SPDX-License-Identifier: AGPL-3.0-or-later

package updatecheck

import "testing"

func TestSeverity(t *testing.T) {
	cases := []struct {
		current, latest, want string
	}{
		{"1.9.0", "1.10.0", "minor"},
		{"1.9.0", "2.0.0", "major"},
		{"1.9.0", "1.9.1", "patch"},
		{"1.10.0", "1.10.0", "none"},
		{"1.11.0", "1.10.0", "none"}, // current ahead
		{"v1.9.0", "v1.10.0", "minor"},
		{"1.9.0-rc1", "1.9.0", "none"}, // pre-release metadata dropped
		{"dev", "1.10.0", ""},          // unparseable current
		{"1.10.0", "weird", ""},        // unparseable latest
	}
	for _, c := range cases {
		if got := Severity(c.current, c.latest); got != c.want {
			t.Errorf("Severity(%q, %q) = %q, want %q", c.current, c.latest, got, c.want)
		}
	}
}

func TestUpdateAvailable(t *testing.T) {
	if !UpdateAvailable("1.9.0", "1.10.0") {
		t.Error("expected update available for 1.9.0 -> 1.10.0")
	}
	if UpdateAvailable("1.10.0", "1.10.0") {
		t.Error("expected no update for equal versions")
	}
	if UpdateAvailable("dev", "1.10.0") {
		t.Error("expected no update when current version is unparseable")
	}
}
