// SPDX-License-Identifier: AGPL-3.0-or-later

package run

import "testing"

func TestClassify(t *testing.T) {
	cases := []struct {
		prompt string
		secret bool
		want   Kind
	}{
		{"Enter password for Teleport user vineeth:", true, KindPassword},
		{"Enter your OTP token:", true, KindTOTP},
		{"Enter an OTP code from a device:", true, KindTOTP},
		{"Tap any security key or enter a code from a OTP device:", true, KindTOTP},
		{"Enter an OTP code from a device:", false, KindTOTP},
		{"Enter password:", true, KindPassword},
		{"vineeth@web01's password:", true, KindPassword},
		{"Password:", true, KindPassword},
		{"Enter passphrase for key '/home/x/.ssh/id_ed25519':", true, KindPassword},
		{"", true, KindPassword},
		{"Username for 'https://github.com':", false, KindUsername},
		{"Password for 'https://vineeth@github.com':", true, KindPassword},
		{"login:", false, KindUsername},
		{"Email address:", false, KindUsername},
		{"Enter OTP:", false, KindTOTP},
		{"Verification code:", false, KindTOTP},
		{"\x1b[1mEnter username\x1b[0m: ", false, KindUsername},
		{"Are you sure you want to continue connecting (yes/no/[fingerprint])?", false, KindNone},
		{"Connected to db.example.com", false, KindNone},
		{"user data loaded", false, KindNone},
		{"mysql>", false, KindNone},
		{"", false, KindNone},
	}
	for _, tc := range cases {
		if got := Classify(tc.prompt, tc.secret); got != tc.want {
			t.Errorf("Classify(%q, secret=%v) = %v, want %v", tc.prompt, tc.secret, got, tc.want)
		}
	}
}

func TestLastLine(t *testing.T) {
	out := []byte("hello\r\n\x1b[32mEnter\x1b[0m password: ")
	if got := LastLine(out); got != "Enter password:" {
		t.Errorf("got %q", got)
	}
	if got := LastLine([]byte("done\r\n")); got != "" {
		t.Errorf("trailing newline should give empty, got %q", got)
	}
}
