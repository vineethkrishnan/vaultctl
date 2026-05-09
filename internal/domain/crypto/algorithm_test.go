// SPDX-License-Identifier: AGPL-3.0-or-later

package crypto

import "testing"

func TestAlgID_IsValid(t *testing.T) {
	t.Parallel()
	cases := []struct {
		alg  AlgID
		want bool
	}{
		{AlgAES256GCM, true},
		{AlgRSAOAEPSHA256, true},
		{AlgAES256KW, true},
		{AlgID(0x00), false},
		{AlgID(0xff), false},
		{AlgID(0x04), false},
	}
	for _, tc := range cases {
		if got := tc.alg.IsValid(); got != tc.want {
			t.Fatalf("AlgID(0x%02x).IsValid() = %v, want %v", byte(tc.alg), got, tc.want)
		}
	}
}

func TestAlgID_String(t *testing.T) {
	t.Parallel()
	cases := []struct {
		alg  AlgID
		want string
	}{
		{AlgAES256GCM, "AES-256-GCM"},
		{AlgRSAOAEPSHA256, "RSA-OAEP-SHA256-2048"},
		{AlgAES256KW, "AES-256-KW"},
		{AlgID(0xab), "unknown(0xab)"},
	}
	for _, tc := range cases {
		if got := tc.alg.String(); got != tc.want {
			t.Fatalf("%02x: got %q want %q", byte(tc.alg), got, tc.want)
		}
	}
}

func TestAlgID_Sizes(t *testing.T) {
	t.Parallel()
	cases := []struct {
		alg                AlgID
		wantNonce, wantTag int
	}{
		{AlgAES256GCM, 12, 16},
		{AlgRSAOAEPSHA256, 0, 0},
		{AlgAES256KW, 0, 8},
		{AlgID(0x99), 0, 0},
	}
	for _, tc := range cases {
		if got := tc.alg.NonceSize(); got != tc.wantNonce {
			t.Fatalf("%s NonceSize = %d, want %d", tc.alg, got, tc.wantNonce)
		}
		if got := tc.alg.TagSize(); got != tc.wantTag {
			t.Fatalf("%s TagSize = %d, want %d", tc.alg, got, tc.wantTag)
		}
	}
}
