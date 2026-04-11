package clientcrypto

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"errors"
	"fmt"
)

// Ed25519KeyPair holds the DER-encoded identity material. The public key is
// the raw 32-byte Ed25519 point (matching what the server's domain layer
// wraps in crypto.PublicKey), while the private key is PKCS#8 so it can be
// re-imported by stdlib or Web Crypto on a browser client.
type Ed25519KeyPair struct {
	PublicKey       ed25519.PublicKey  // 32 raw bytes
	PrivateKeyPKCS8 []byte             // PKCS#8 DER
	PrivateKey      ed25519.PrivateKey // 64-byte seed||pub expansion — zeroise after use
}

// GenerateEd25519KeyPair returns a freshly generated identity key pair. The
// private key is exposed twice: the raw ed25519.PrivateKey for immediate use
// (signing during registration) and as PKCS#8 DER for persistence.
func GenerateEd25519KeyPair() (Ed25519KeyPair, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return Ed25519KeyPair{}, fmt.Errorf("clientcrypto: ed25519 generate: %w", err)
	}
	pkcs8, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return Ed25519KeyPair{}, fmt.Errorf("clientcrypto: marshal private: %w", err)
	}
	return Ed25519KeyPair{
		PublicKey:       pub,
		PrivateKeyPKCS8: pkcs8,
		PrivateKey:      priv,
	}, nil
}

// ParseEd25519PrivateKey decodes a PKCS#8 DER blob into an
// ed25519.PrivateKey. It is the inverse of GenerateEd25519KeyPair's PKCS#8
// output and is invoked after decrypting the user's stored identity key.
func ParseEd25519PrivateKey(pkcs8 []byte) (ed25519.PrivateKey, error) {
	key, err := x509.ParsePKCS8PrivateKey(pkcs8)
	if err != nil {
		return nil, fmt.Errorf("clientcrypto: parse ed25519 private: %w", err)
	}
	priv, ok := key.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("clientcrypto: not an ed25519 private key")
	}
	return priv, nil
}

// Sign produces an Ed25519 signature over message. This is used for the
// wrap_signature on shared-vault membership rows.
func Sign(priv ed25519.PrivateKey, message []byte) []byte {
	return ed25519.Sign(priv, message)
}

// Verify validates an Ed25519 signature. Returns nil on success.
func Verify(pub ed25519.PublicKey, message, sig []byte) error {
	if !ed25519.Verify(pub, message, sig) {
		return errors.New("clientcrypto: ed25519 signature verification failed")
	}
	return nil
}
