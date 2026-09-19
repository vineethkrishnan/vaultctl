// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import "testing"

func TestHostMatches(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"www.bank.com", "bank.com", true},
		{"BANK.com", "bank.COM", true},
		{"accounts.google.com", "mail.google.com", false},
		{"teleport.locaboo.de", "teleport.locaboo.de", true},
		{"db.example.com:3306", "db.example.com", false},
		{"db.example.com:3306", "db.example.com:3306", true},
		{"", "bank.com", false},
		{"bank.com", "", false},
	}
	for _, tc := range cases {
		if got := hostMatches(tc.a, tc.b); got != tc.want {
			t.Errorf("hostMatches(%q, %q) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestSafeHost(t *testing.T) {
	cases := map[string]string{
		"https://teleport.locaboo.de/web/login": "teleport.locaboo.de",
		"https://teleport.locaboo.de:443":       "teleport.locaboo.de",
		"http://localhost:8080":                 "localhost:8080",
		"http://intranet:80/":                   "intranet",
		"mysql://db.example.com:3306":           "db.example.com:3306",
		"db.example.com:3306":                   "db.example.com:3306",
		"teleport.locaboo.de":                   "teleport.locaboo.de",
		"  github.com  ":                        "github.com",
	}
	for input, want := range cases {
		if got := safeHost(input); got != want {
			t.Errorf("safeHost(%q) = %q, want %q", input, got, want)
		}
	}
}
