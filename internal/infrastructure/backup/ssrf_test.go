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
		if err := checkDialIP(net.ParseIP(s)); err == nil {
			t.Errorf("checkDialIP(%s) = nil, want blocked", s)
		}
	}

	// Public and private-LAN addresses are allowed (private self-hosted
	// destinations like a LAN Nextcloud/MinIO are intentionally permitted).
	allowed := []string{"8.8.8.8", "1.1.1.1", "10.0.0.5", "192.168.1.10", "172.16.0.1"}
	for _, s := range allowed {
		if err := checkDialIP(net.ParseIP(s)); err != nil {
			t.Errorf("checkDialIP(%s) = %v, want allowed", s, err)
		}
	}
}
