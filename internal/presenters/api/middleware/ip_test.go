// SPDX-License-Identifier: AGPL-3.0-or-later

package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

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

func TestParseTrustedProxies(t *testing.T) {
	good, err := ParseTrustedProxies([]string{"10.0.0.0/8", "127.0.0.1", "::1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(good) != 3 {
		t.Fatalf("want 3 nets, got %d", len(good))
	}
	if _, err := ParseTrustedProxies([]string{"not-a-cidr"}); err == nil {
		t.Fatal("expected error on malformed CIDR")
	}
}

func TestRealIP_SpoofingResistance(t *testing.T) {
	const (
		loopbackCIDR = "127.0.0.0/8"
		loopbackHost = "127.0.0.1"
		loopbackPeer = loopbackHost + ":54321"
		publicClient = "8.8.8.8"
	)

	cases := []struct {
		name     string
		trusted  []string
		peer     string
		xff      string
		wantAddr string
	}{
		{
			name:     "trusted peer honours rightmost-untrusted XFF entry",
			trusted:  []string{loopbackCIDR},
			peer:     loopbackPeer,
			xff:      publicClient,
			wantAddr: publicClient,
		},
		{
			name:     "spoofed left-side XFF entries are ignored",
			trusted:  []string{loopbackCIDR},
			peer:     loopbackPeer,
			xff:      "1.2.3.4, " + publicClient,
			wantAddr: publicClient,
		},
		{
			name:     "untrusted peer cannot inject XFF",
			trusted:  []string{loopbackCIDR},
			peer:     "203.0.113.99:443",
			xff:      publicClient,
			wantAddr: "203.0.113.99",
		},
		{
			name:     "empty trusted list disables XFF",
			trusted:  nil,
			peer:     loopbackPeer,
			xff:      publicClient,
			wantAddr: loopbackHost,
		},
		{
			name:     "no XFF leaves peer intact",
			trusted:  []string{loopbackCIDR},
			peer:     loopbackPeer,
			xff:      "",
			wantAddr: loopbackHost,
		},
		{
			name:     "chained trusted proxies walk back to the client",
			trusted:  []string{loopbackCIDR, "10.0.0.0/8"},
			peer:     "10.0.0.5:443",
			xff:      publicClient + ", 10.0.0.7, 127.0.0.2",
			wantAddr: publicClient,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			trusted, err := ParseTrustedProxies(tc.trusted)
			if err != nil {
				t.Fatal(err)
			}

			var got string
			handler := RealIP(trusted)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				got = r.RemoteAddr
			}))

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tc.peer
			if tc.xff != "" {
				req.Header.Set("X-Forwarded-For", tc.xff)
			}
			handler.ServeHTTP(httptest.NewRecorder(), req)

			if got != tc.wantAddr {
				t.Errorf("RemoteAddr = %q, want %q", got, tc.wantAddr)
			}
		})
	}
}

func TestClientIP_AnonymisesValidatedAddr(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "198.51.100.42:54321"
	const want = "198.51.100.0"
	if got := ClientIP(req); got != want {
		t.Errorf("ClientIP = %q, want %q", got, want)
	}
}
