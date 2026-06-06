// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"context"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func TestDescribeUserAgent(t *testing.T) {
	tests := []struct {
		ua   string
		want string
	}{
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120.0 Safari/537.36", "Chrome on macOS"},
		{"Mozilla/5.0 (Windows NT 10.0) Firefox/119.0", "Firefox on Windows"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1", "Safari on iOS"},
		{"Mozilla/5.0 (Windows NT 10.0) Edg/120.0", "Edge on Windows"},
		{"", "an unrecognised device"},
	}
	for _, tt := range tests {
		if got := DescribeUserAgent(tt.ua); got != tt.want {
			t.Errorf("DescribeUserAgent(%q) = %q, want %q", tt.ua, got, tt.want)
		}
	}
}

type loginKey struct{ fp, network string }

type memKnownLogins struct {
	byUser map[user.ID][]loginKey
}

func newMemKnownLogins() *memKnownLogins {
	return &memKnownLogins{byUser: map[user.ID][]loginKey{}}
}

func (m *memKnownLogins) Observe(_ context.Context, userID user.ID, fingerprint []byte, network, _ string, _ time.Time) (ports.KnownLoginObservation, error) {
	fp := string(fingerprint)
	rows := m.byUser[userID]
	obs := ports.KnownLoginObservation{AnySeen: len(rows) > 0}
	for _, k := range rows {
		if k.fp == fp {
			obs.DeviceSeen = true
		}
		if k.fp == fp && k.network == network {
			// Pair already recorded: an upsert, not an insert.
			return obs, nil
		}
	}
	obs.Inserted = true
	m.byUser[userID] = append(m.byUser[userID], loginKey{fp, network})
	return obs, nil
}

type loginAlertCall struct{ to, reason, label, ip string }

type capturingLoginSender struct{ calls []loginAlertCall }

func (s *capturingLoginSender) SendLoginAlert(_ context.Context, to, reason, label, ip string, _ time.Time) error {
	s.calls = append(s.calls, loginAlertCall{to, reason, label, ip})
	return nil
}

func TestNotifyLogin(t *testing.T) {
	now := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	const (
		chromeMac = "Mozilla/5.0 (Macintosh; Mac OS X) Chrome/120 Safari/537"
		firefox   = "Mozilla/5.0 (Windows NT 10.0) Firefox/119"
	)

	known := newMemKnownLogins()
	sender := &capturingLoginSender{}
	uc := &NotifyLogin{Known: known, HMAC: fakeHMAC{}, Clock: ports.ClockFunc(func() time.Time { return now }), Sender: sender, NewNetworkEnabled: true}
	ctx := context.Background()
	const uid user.ID = "u1"
	const to = "a@example.com"
	const device = "Alice's laptop"

	// First login: recorded, no alert (signup device).
	must(t, uc.Execute(ctx, uid, to, device, chromeMac, "203.0.113.0"))
	if len(sender.calls) != 0 {
		t.Fatalf("first login alerted: %+v", sender.calls)
	}

	// Same device + network again: no alert.
	must(t, uc.Execute(ctx, uid, to, device, chromeMac, "203.0.113.0"))
	if len(sender.calls) != 0 {
		t.Fatalf("repeat login alerted: %+v", sender.calls)
	}

	// New device: alert new_device.
	must(t, uc.Execute(ctx, uid, to, device, firefox, "203.0.113.0"))
	if len(sender.calls) != 1 || sender.calls[0].reason != LoginReasonNewDevice {
		t.Fatalf("expected new_device alert, got %+v", sender.calls)
	}

	// Known device (chrome) from a new network: alert new_network (enabled here).
	must(t, uc.Execute(ctx, uid, to, device, chromeMac, "198.51.100.0"))
	if len(sender.calls) != 2 || sender.calls[1].reason != LoginReasonNewNetwork {
		t.Fatalf("expected new_network alert, got %+v", sender.calls)
	}

	// Empty user-agent: never alerts (cannot describe the device).
	must(t, uc.Execute(ctx, uid, to, device, "", "192.0.2.0"))
	if len(sender.calls) != 2 {
		t.Fatalf("empty UA alerted: %+v", sender.calls)
	}
}

func TestNotifyLogin_NewNetworkDisabledByDefault(t *testing.T) {
	now := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	const chromeMac = "Mozilla/5.0 (Macintosh; Mac OS X) Chrome/120 Safari/537"

	known := newMemKnownLogins()
	sender := &capturingLoginSender{}
	uc := &NotifyLogin{Known: known, HMAC: fakeHMAC{}, Clock: ports.ClockFunc(func() time.Time { return now }), Sender: sender}
	ctx := context.Background()
	const uid user.ID = "u1"
	const to = "a@example.com"
	const device = "Alice's laptop"

	must(t, uc.Execute(ctx, uid, to, device, chromeMac, "203.0.113.0"))  // signup device
	must(t, uc.Execute(ctx, uid, to, device, chromeMac, "198.51.100.0")) // known device, new network
	if len(sender.calls) != 0 {
		t.Fatalf("new_network alerted while disabled: %+v", sender.calls)
	}
}

func TestNotifyLogin_DeviceNameInFingerprint(t *testing.T) {
	now := time.Date(2026, 6, 5, 9, 0, 0, 0, time.UTC)
	const chromeMac = "Mozilla/5.0 (Macintosh; Mac OS X) Chrome/120 Safari/537"

	known := newMemKnownLogins()
	sender := &capturingLoginSender{}
	uc := &NotifyLogin{Known: known, HMAC: fakeHMAC{}, Clock: ports.ClockFunc(func() time.Time { return now }), Sender: sender}
	ctx := context.Background()
	const uid user.ID = "u1"
	const to = "a@example.com"

	// Same browser/OS, different device names => different fingerprints, so the
	// second distinct device is detected as new rather than colliding.
	must(t, uc.Execute(ctx, uid, to, "Alice's laptop", chromeMac, "203.0.113.0"))
	must(t, uc.Execute(ctx, uid, to, "Alice's desktop", chromeMac, "203.0.113.0"))
	if len(sender.calls) != 1 || sender.calls[0].reason != LoginReasonNewDevice {
		t.Fatalf("expected new_device for distinct device name, got %+v", sender.calls)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
