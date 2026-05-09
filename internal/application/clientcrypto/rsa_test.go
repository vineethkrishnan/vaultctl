// SPDX-License-Identifier: AGPL-3.0-or-later

package clientcrypto_test

import (
	"bytes"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/application/clientcrypto"
)

func TestRSA_GenerateParseRoundTrip(t *testing.T) {
	kp, err := clientcrypto.GenerateRSAKeyPair()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if _, err := clientcrypto.ParseRSAPublicKey(kp.PublicKeySPKI); err != nil {
		t.Errorf("parse public: %v", err)
	}
	if _, err := clientcrypto.ParseRSAPrivateKey(kp.PrivateKeyPKCS8); err != nil {
		t.Errorf("parse private: %v", err)
	}
}

func TestRSA_OAEPEncryptDecrypt(t *testing.T) {
	kp, err := clientcrypto.GenerateRSAKeyPair()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	pub, err := clientcrypto.ParseRSAPublicKey(kp.PublicKeySPKI)
	if err != nil {
		t.Fatalf("parse pub: %v", err)
	}
	priv, err := clientcrypto.ParseRSAPrivateKey(kp.PrivateKeyPKCS8)
	if err != nil {
		t.Fatalf("parse priv: %v", err)
	}

	vaultKey := bytes.Repeat([]byte{0x77}, 32)
	blob, err := clientcrypto.RSAOAEPEncrypt(pub, vaultKey)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if err := blob.Validate(); err != nil {
		t.Fatalf("blob.Validate: %v", err)
	}
	pt, err := clientcrypto.RSAOAEPDecrypt(priv, blob)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if !bytes.Equal(pt, vaultKey) {
		t.Errorf("round trip mismatch")
	}
}
