// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"crypto/rsa"
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/clientcrypto"
	domaincrypto "github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
)

// Keys is an in-memory bundle of derived material, valid only for one CLI
// invocation. Keys are zeroised when the command finishes.
type Keys struct {
	StretchedKey []byte
	RSAPrivate   *rsa.PrivateKey
	VaultKeys    map[string][]byte // vault id → 32-byte symmetric key
}

// Zero scrubs every sensitive slice held by the bundle.
func (k *Keys) Zero() {
	if k == nil {
		return
	}
	for i := range k.StretchedKey {
		k.StretchedKey[i] = 0
	}
	for _, v := range k.VaultKeys {
		for i := range v {
			v[i] = 0
		}
	}
	k.StretchedKey = nil
	k.RSAPrivate = nil
	k.VaultKeys = nil
}

// ErrLocked is returned when the caller needs a decrypted key but the
// session has no stretched key available (e.g. API-key mode).
var ErrLocked = errors.New("vault is locked; run `vaultctl unlock`")

// unlockKeys unwraps the user's encrypted private key with stretchedKey and
// unwraps every vault key the server returned. Called during login and
// unlock. AAD matches the TS module: "vaultctl:user:<email>:priv" for the
// private key and the wire-format blob for each vault key.
func unlockKeys(session *Session, stretchedKey []byte) (*Keys, error) {
	if session.APIKey != "" {
		return nil, fmt.Errorf("%w: API-key mode cannot decrypt content", ErrLocked)
	}

	// Decrypt the user's private RSA key using the stretched key.
	privBlobBytes, err := base64.StdEncoding.DecodeString(session.EncryptedPrivateKey)
	if err != nil {
		return nil, fmt.Errorf("decode encrypted private key: %w", err)
	}
	privBlob, err := domaincrypto.ParseBlob(privBlobBytes)
	if err != nil {
		return nil, fmt.Errorf("parse encrypted private key: %w", err)
	}
	pkcs8, err := clientcrypto.Decrypt(stretchedKey, privBlob, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt private key (wrong master password?): %w", err)
	}
	rsaPriv, err := clientcrypto.ParseRSAPrivateKey(pkcs8)
	if err != nil {
		return nil, err
	}

	keys := &Keys{
		StretchedKey: append([]byte(nil), stretchedKey...),
		RSAPrivate:   rsaPriv,
		VaultKeys:    make(map[string][]byte, len(session.Vaults)),
	}

	// Unwrap every vault key so subsequent list/get/create commands have
	// per-vault symmetric keys ready.
	for _, vaultMeta := range session.Vaults {
		vaultKey, err := unwrapVaultKey(vaultMeta, rsaPriv, stretchedKey)
		if err != nil {
			return nil, fmt.Errorf("unwrap vault %q: %w", vaultMeta.Name, err)
		}
		keys.VaultKeys[vaultMeta.ID] = vaultKey
	}
	return keys, nil
}

// unwrapVaultKey handles both personal (alg=AES-KW via stretchedKey) and
// shared (alg=RSA-OAEP via rsaPriv) vaults.
func unwrapVaultKey(vaultMeta SessionVault, rsaPriv *rsa.PrivateKey, stretchedKey []byte) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(vaultMeta.EncryptedVaultKey)
	if err != nil {
		return nil, fmt.Errorf("decode encryptedVaultKey: %w", err)
	}
	blob, err := domaincrypto.ParseBlob(raw)
	if err != nil {
		return nil, fmt.Errorf("parse encryptedVaultKey: %w", err)
	}

	switch blob.Alg {
	case domaincrypto.AlgRSAOAEPSHA256:
		return clientcrypto.RSAOAEPDecrypt(rsaPriv, blob)
	case domaincrypto.AlgAES256GCM:
		// Personal vault - key was wrapped with stretchedKey using AEAD.
		return clientcrypto.Decrypt(stretchedKey, blob, nil)
	case domaincrypto.AlgAES256KW:
		return clientcrypto.AESKeyUnwrap(stretchedKey, blob)
	default:
		return nil, fmt.Errorf("unknown vault-key alg: %s", blob.Alg)
	}
}
