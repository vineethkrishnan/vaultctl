package clientcrypto

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"errors"
	"fmt"

	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// RSAModulusBits matches the web module's RSA_MODULUS_LENGTH: 2048.
const RSAModulusBits = 2048

// RSAKeyPair holds DER-encoded SPKI (public) + PKCS#8 (private) bytes,
// which is exactly what the browser Web Crypto API exports and imports and
// what the server's domain layer expects.
type RSAKeyPair struct {
	PublicKeySPKI   []byte
	PrivateKeyPKCS8 []byte
}

// GenerateRSAKeyPair produces a fresh RSA-2048 key pair suitable for
// RSA-OAEP-SHA256 wrapping of vault keys in shared vaults.
func GenerateRSAKeyPair() (RSAKeyPair, error) {
	priv, err := rsa.GenerateKey(rand.Reader, RSAModulusBits)
	if err != nil {
		return RSAKeyPair{}, fmt.Errorf("clientcrypto: rsa generate: %w", err)
	}
	pub, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		return RSAKeyPair{}, fmt.Errorf("clientcrypto: marshal public: %w", err)
	}
	privDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return RSAKeyPair{}, fmt.Errorf("clientcrypto: marshal private: %w", err)
	}
	return RSAKeyPair{PublicKeySPKI: pub, PrivateKeyPKCS8: privDER}, nil
}

// ParseRSAPublicKey decodes an SPKI DER blob into *rsa.PublicKey.
func ParseRSAPublicKey(spki []byte) (*rsa.PublicKey, error) {
	key, err := x509.ParsePKIXPublicKey(spki)
	if err != nil {
		return nil, fmt.Errorf("clientcrypto: parse public: %w", err)
	}
	rsaKey, ok := key.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("clientcrypto: not an RSA public key")
	}
	return rsaKey, nil
}

// ParseRSAPrivateKey decodes a PKCS#8 DER blob into *rsa.PrivateKey.
func ParseRSAPrivateKey(pkcs8 []byte) (*rsa.PrivateKey, error) {
	key, err := x509.ParsePKCS8PrivateKey(pkcs8)
	if err != nil {
		return nil, fmt.Errorf("clientcrypto: parse private: %w", err)
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("clientcrypto: not an RSA private key")
	}
	return rsaKey, nil
}

// RSAOAEPEncrypt wraps plaintext with RSA-OAEP-SHA256 and returns a v1
// EncryptedBlob with alg=AlgRSAOAEPSHA256. The blob has no nonce or tag
// because the OAEP primitive carries its own authentication.
func RSAOAEPEncrypt(pub *rsa.PublicKey, plaintext []byte) (domaincrypto.EncryptedBlob, error) {
	ct, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, pub, plaintext, nil)
	if err != nil {
		return domaincrypto.EncryptedBlob{}, fmt.Errorf("clientcrypto: oaep encrypt: %w", err)
	}
	return domaincrypto.EncryptedBlob{
		Version:    domaincrypto.V1,
		Alg:        domaincrypto.AlgRSAOAEPSHA256,
		Nonce:      nil,
		Ciphertext: ct,
		Tag:        nil,
	}, nil
}

// RSAOAEPDecrypt unwraps an RSA-OAEP-SHA256 blob with the supplied private
// key. Rejects blobs with the wrong algorithm ID.
func RSAOAEPDecrypt(priv *rsa.PrivateKey, blob domaincrypto.EncryptedBlob) ([]byte, error) {
	if err := blob.Validate(); err != nil {
		return nil, err
	}
	if blob.Alg != domaincrypto.AlgRSAOAEPSHA256 {
		return nil, fmt.Errorf("%w: alg=%s", ErrWrongAlgorithm, blob.Alg)
	}
	pt, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, priv, blob.Ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("clientcrypto: oaep decrypt: %w", err)
	}
	return pt, nil
}
