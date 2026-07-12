// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"net"
	"testing"
)

func TestCheckDialIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1",       // loopback
		"::1",             // loopback v6
		"169.254.169.254", // cloud metadata (link-local)
		"fe80::1",         // link-local v6
		"0.0.0.0",         // unspecified
		"224.0.0.1",       // multicast
	}
	for _, s := range blocked {
		if err := checkDialIP(net.ParseIP(s), true); err == nil {
			t.Errorf("checkDialIP(%s) = nil, want blocked", s)
		}
	}

	// With allowPrivate=true (the default), public and private-LAN addresses are
	// allowed (a LAN Nextcloud/MinIO is an intentional self-hosted destination).
	allowed := []string{"8.8.8.8", "1.1.1.1", "10.0.0.5", "192.168.1.10", "172.16.0.1"}
	for _, s := range allowed {
		if err := checkDialIP(net.ParseIP(s), true); err != nil {
			t.Errorf("checkDialIP(%s, allowPrivate=true) = %v, want allowed", s, err)
		}
	}
}

func TestCheckDialIP_BlockPrivate(t *testing.T) {
	// With allowPrivate=false (multi-user posture), RFC1918 / ULA are blocked...
	blockedPrivate := []string{"10.0.0.5", "192.168.1.10", "172.16.0.1", "fd00::1"}
	for _, s := range blockedPrivate {
		if err := checkDialIP(net.ParseIP(s), false); err == nil {
			t.Errorf("checkDialIP(%s, allowPrivate=false) = nil, want blocked", s)
		}
	}
	// ...but genuine public destinations still work.
	for _, s := range []string{"8.8.8.8", "1.1.1.1"} {
		if err := checkDialIP(net.ParseIP(s), false); err != nil {
			t.Errorf("checkDialIP(%s, allowPrivate=false) = %v, want allowed", s, err)
		}
	}
}
