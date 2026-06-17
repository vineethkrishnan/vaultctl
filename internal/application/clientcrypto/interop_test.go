// SPDX-License-Identifier: AGPL-3.0-or-later

package clientcrypto_test

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/application/clientcrypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

type argon2idFixture struct {
	Password     string `json:"password"`
	SaltB64      string `json:"salt_b64"`
	Iterations   uint32 `json:"iterations"`
	MemoryKB     uint32 `json:"memory_kb"`
	Parallelism  uint8  `json:"parallelism"`
	MasterKeyB64 string `json:"master_key_b64"`
}

// TestInterop_Argon2idDerivation verifies the Go master-key derivation produces
// byte-identical output to the web hash-wasm implementation that generated the
// fixtures. Together with the mobile on-device self-check (verifyArgon2id.ts),
// this locks all three Argon2id implementations to one canonical vector.
func TestInterop_Argon2idDerivation(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "testdata", "crypto")
	path := filepath.Join(dir, "argon2_fixtures.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixtures at %s (run 'cd web && npx vitest run src/shared/crypto/interop-fixtures.test.ts' first): %v", path, err)
	}

	var fixtures []argon2idFixture
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(fixtures) == 0 {
		t.Fatal("no argon2 fixtures found")
	}

	for i, f := range fixtures {
		salt, err := base64.StdEncoding.DecodeString(f.SaltB64)
		if err != nil {
			t.Fatalf("fixture %d: decode salt: %v", i, err)
		}

		derived, err := clientcrypto.DeriveKeys(f.Password, salt, user.KDFParams{
			Iterations:  f.Iterations,
			MemoryKB:    f.MemoryKB,
			Parallelism: f.Parallelism,
		})
		if err != nil {
			t.Fatalf("fixture %d: derive: %v", i, err)
		}
		defer derived.Zero()

		got := base64.StdEncoding.EncodeToString(derived.MasterKey)
		if got != f.MasterKeyB64 {
			t.Errorf("fixture %d (%q): master key mismatch\n got: %s\nwant: %s", i, f.Password, got, f.MasterKeyB64)
		}
	}
}
