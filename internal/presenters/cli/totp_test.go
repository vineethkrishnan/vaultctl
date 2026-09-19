// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"testing"
	"time"
)

// RFC 6238 appendix B vectors for the 20-byte SHA1 secret "12345678901234567890".
const rfcSecretBase32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

func TestTotpCodeAt_BareSecretRFCVectors(t *testing.T) {
	vectors := []struct {
		at   int64
		want string
	}{
		{59, "287082"},
		{1111111109, "081804"},
		{1234567890, "005924"},
	}
	for _, v := range vectors {
		got, err := totpCodeAt(rfcSecretBase32, time.Unix(v.at, 0))
		if err != nil {
			t.Fatalf("T=%d: %v", v.at, err)
		}
		if got != v.want {
			t.Errorf("T=%d: got %s want %s", v.at, got, v.want)
		}
	}
}

func TestTotpCodeAt_OtpauthURIHonoursDigits(t *testing.T) {
	got, err := totpCodeAt("otpauth://totp/x?secret="+rfcSecretBase32+"&digits=8", time.Unix(59, 0))
	if err != nil {
		t.Fatal(err)
	}
	if got != "94287082" {
		t.Errorf("got %s want 94287082", got)
	}
}

func TestTotpCodeAt_OtpauthURIHonoursPeriodAndAlgorithm(t *testing.T) {
	// RFC 6238 SHA256 vector uses a 32-byte secret; with period=60 the
	// counter at T=119 is 1, the same as SHA1 T=59 with period 30.
	sha256Secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA"
	got, err := totpCodeAt("otpauth://totp/x?secret="+sha256Secret+"&digits=8&period=60&algorithm=SHA256", time.Unix(119, 0))
	if err != nil {
		t.Fatal(err)
	}
	if got != "46119246" {
		t.Errorf("got %s want 46119246", got)
	}
}

func TestTotpCodeAt_Errors(t *testing.T) {
	if _, err := totpCodeAt("   ", time.Now()); err == nil {
		t.Error("empty secret should fail")
	}
	if _, err := totpCodeAt("otpauth://totp/x?digits=6", time.Now()); err == nil {
		t.Error("otpauth without secret should fail")
	}
	if _, err := totpCodeAt("0189!", time.Now()); err == nil {
		t.Error("invalid base32 should fail")
	}
}

func TestTotpSecondsRemaining(t *testing.T) {
	if got := totpSecondsRemaining(rfcSecretBase32, time.Unix(1, 0)); got != 29 {
		t.Errorf("bare secret at T=1: got %d want 29", got)
	}
	if got := totpSecondsRemaining("otpauth://totp/x?secret=AAAA&period=60", time.Unix(60, 0)); got != 60 {
		t.Errorf("period 60 at T=60: got %d want 60", got)
	}
}
