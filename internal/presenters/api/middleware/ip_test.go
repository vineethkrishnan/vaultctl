package middleware

import "testing"

func TestAnonymiseIP(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"malformed", "not-an-ip", ""},
		{"ipv4 bare", "203.0.113.7", "203.0.113.0"},
		{"ipv4 with port", "203.0.113.7:54321", "203.0.113.0"},
		{"ipv4 loopback", "127.0.0.1", "127.0.0.0"},
		{"ipv6 loopback", "::1", "::"},
		{"ipv6 bracket port", "[2001:db8:1234:5678::1]:443", "2001:db8:1234:5600::"},
		{"ipv6 no port", "2001:db8:1234:5678::1", "2001:db8:1234:5600::"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := AnonymiseIP(tc.in)
			if got != tc.want {
				t.Errorf("AnonymiseIP(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
