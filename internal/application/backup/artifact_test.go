// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"bytes"
	"encoding/base64"
	"testing"

	infracrypto "github.com/vineethkrishnan/vaultctl/internal/infrastructure/crypto"
)

func newTestSealer(t *testing.T) *infracrypto.ServerAEAD {
	t.Helper()
	key := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x42}, 32))
	aead, err := infracrypto.NewServerAEAD(key, "")
	if err != nil {
		t.Fatalf("NewServerAEAD: %v", err)
	}
	return aead
}

func TestSealOpenRoundTrip(t *testing.T) {
	sealer := newTestSealer(t)
	payload := []byte(`{"vaults":[],"items":[]}`)

	sealed, err := sealArtifact(sealer, "dest-1", payload)
	if err != nil {
		t.Fatalf("sealArtifact: %v", err)
	}
	if bytes.Contains(sealed, payload) {
		t.Fatal("sealed artifact leaked plaintext")
	}

	got, err := openArtifact(sealer, "dest-1", sealed)
	if err != nil {
		t.Fatalf("openArtifact: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("round-trip mismatch: got %q", got)
	}
}

func TestOpenRejectsWrongDestination(t *testing.T) {
	sealer := newTestSealer(t)
	sealed, err := sealArtifact(sealer, "dest-1", []byte("secret"))
	if err != nil {
		t.Fatalf("sealArtifact: %v", err)
	}
	// AAD binds the artifact to its destination; opening under another
	// destination ID must fail.
	if _, err := openArtifact(sealer, "dest-2", sealed); err == nil {
		t.Fatal("opening with wrong destination ID should fail")
	}
}
