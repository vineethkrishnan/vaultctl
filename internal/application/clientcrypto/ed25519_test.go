// SPDX-License-Identifier: AGPL-3.0-or-later

package clientcrypto_test

import (
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/application/clientcrypto"
)

func TestEd25519_SignVerifyRoundTrip(t *testing.T) {
	kp, err := clientcrypto.GenerateEd25519KeyPair()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	msg := []byte("wrap signature payload")
	sig := clientcrypto.Sign(kp.PrivateKey, msg)
	if err := clientcrypto.Verify(kp.PublicKey, msg, sig); err != nil {
		t.Errorf("verify: %v", err)
	}

	// Sanity: tamper with message → verification must fail.
	if err := clientcrypto.Verify(kp.PublicKey, []byte("other"), sig); err == nil {
		t.Errorf("verify should fail on tampered message")
	}
}

func TestEd25519_ParsePrivateKey(t *testing.T) {
	kp, err := clientcrypto.GenerateEd25519KeyPair()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	priv, err := clientcrypto.ParseEd25519PrivateKey(kp.PrivateKeyPKCS8)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	sig := clientcrypto.Sign(priv, []byte("x"))
	if err := clientcrypto.Verify(kp.PublicKey, []byte("x"), sig); err != nil {
		t.Errorf("verify with re-parsed key: %v", err)
	}
}
