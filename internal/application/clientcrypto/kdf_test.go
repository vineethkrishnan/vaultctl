// SPDX-License-Identifier: AGPL-3.0-or-later

package clientcrypto_test

import (
	"bytes"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/application/clientcrypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// cheapParams keeps unit tests fast while still exercising the real
// Argon2id primitive. Production paths use user.DefaultKDFParams().
var cheapParams = user.KDFParams{Iterations: 1, MemoryKB: 19456, Parallelism: 1}

func TestDeriveKeys_Deterministic(t *testing.T) {
	salt := bytes.Repeat([]byte{0xab}, 16)

	a, err := clientcrypto.DeriveKeys("correct horse battery staple", salt, cheapParams)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	b, err := clientcrypto.DeriveKeys("correct horse battery staple", salt, cheapParams)
	if err != nil {
		t.Fatalf("derive again: %v", err)
	}

	if !bytes.Equal(a.AuthHash, b.AuthHash) {
		t.Errorf("authHash should be deterministic")
	}
	if !bytes.Equal(a.StretchedKey, b.StretchedKey) {
		t.Errorf("stretchedKey should be deterministic")
	}
	if bytes.Equal(a.AuthHash, a.StretchedKey) {
		t.Errorf("authHash and stretchedKey must differ (HKDF context split)")
	}
}

func TestDeriveKeys_DifferentPasswordProducesDifferentKeys(t *testing.T) {
	salt := bytes.Repeat([]byte{0x01}, 16)

	a, err := clientcrypto.DeriveKeys("aaa", salt, cheapParams)
	if err != nil {
		t.Fatalf("derive a: %v", err)
	}
	b, err := clientcrypto.DeriveKeys("bbb", salt, cheapParams)
	if err != nil {
		t.Fatalf("derive b: %v", err)
	}
	if bytes.Equal(a.AuthHash, b.AuthHash) {
		t.Errorf("different passwords must yield different authHashes")
	}
}

func TestDeriveKeys_SaltTooShort(t *testing.T) {
	if _, err := clientcrypto.DeriveKeys("x", make([]byte, 15), cheapParams); err == nil {
		t.Errorf("expected error on 15-byte salt")
	}
}

func TestDerivedKeys_Zero(t *testing.T) {
	salt := bytes.Repeat([]byte{0x02}, 16)
	keys, err := clientcrypto.DeriveKeys("hunter2", salt, cheapParams)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	keys.Zero()
	if !allZero(keys.AuthHash) || !allZero(keys.StretchedKey) || !allZero(keys.MasterKey) {
		t.Errorf("Zero() must scrub every byte")
	}
}

func allZero(b []byte) bool {
	for _, v := range b {
		if v != 0 {
			return false
		}
	}
	return true
}
