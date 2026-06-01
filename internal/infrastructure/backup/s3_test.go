// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"strings"
	"testing"
	"time"
)

// Known-answer test from the AWS SigV4 test suite ("get-vanilla"): validates
// the canonical-request -> string-to-sign -> signature pipeline against the
// documented expected signature, so the signer can't silently drift.
func TestSigV4KnownAnswer(t *testing.T) {
	tStamp := time.Date(2015, 8, 30, 12, 36, 0, 0, time.UTC)
	headers := map[string]string{
		"host":       "example.amazonaws.com",
		"x-amz-date": "20150830T123600Z",
	}
	// Empty-body payload hash (sha256 of "").
	const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	auth := sigv4Sign(
		"GET", "/", "", headers, emptyHash,
		"AKIDEXAMPLE", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
		"us-east-1", "service", tStamp,
	)
	const wantSig = "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
	if !strings.Contains(auth, wantSig) {
		t.Fatalf("SigV4 signature mismatch.\n got: %s\nwant substring: %s", auth, wantSig)
	}
	if !strings.Contains(auth, "SignedHeaders=host;x-amz-date") {
		t.Fatalf("unexpected signed headers in: %s", auth)
	}
}
