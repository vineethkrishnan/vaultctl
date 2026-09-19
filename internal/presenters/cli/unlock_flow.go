// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/clientcrypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// deriveSessionKeys unwraps the RSA private key + every vault key, taking
// the stretched key from the agent when it holds one and otherwise
// prompting for the master password and re-running prelogin + Argon2id. A
// prompt-derived key is handed to a running agent so the next command does
// not prompt again. It is the shared path used by list/get/create/edit/
// delete/totp/run.
//
// API-key mode is rejected because those commands need access to plaintext
// vault items which requires the master password.
func deriveSessionKeys(session *Session) (*Keys, error) {
	if session.APIKey != "" {
		return nil, errors.New("this command requires a master-password session; VAULTCTL_API_KEY alone cannot decrypt vault items")
	}
	if cached, err := agentFetchKey(); err == nil && cached != nil {
		keys, err := unlockKeys(session, cached)
		zeroBytes(cached)
		if err == nil {
			return keys, nil
		}
	}
	stretchedKey, err := promptStretchedKey(session)
	if err != nil {
		return nil, err
	}
	defer zeroBytes(stretchedKey)
	keys, err := unlockKeys(session, stretchedKey)
	if err != nil {
		return nil, err
	}
	agentStoreKeyIfRunning(stretchedKey)
	return keys, nil
}

// promptStretchedKey asks for the master password and derives the
// stretched key with the user's current KDF parameters from prelogin. The
// caller owns the returned slice and must zero it.
func promptStretchedKey(session *Session) ([]byte, error) {
	preloginRaw, err := httpGet("/auth/prelogin?email="+urlQueryEscape(session.Email), nil)
	if err != nil {
		return nil, err
	}
	var prelogin struct {
		Salt        string `json:"salt"`
		Iterations  uint32 `json:"iterations"`
		MemoryKB    uint32 `json:"memoryKB"`
		Parallelism uint8  `json:"parallelism"`
	}
	if err := unmarshalJSON(preloginRaw, &prelogin); err != nil {
		return nil, err
	}
	salt, err := base64.StdEncoding.DecodeString(prelogin.Salt)
	if err != nil {
		return nil, fmt.Errorf("decode salt: %w", err)
	}
	password, err := promptPassword("Master password")
	if err != nil {
		return nil, err
	}
	derived, err := clientcrypto.DeriveKeys(password, salt, user.KDFParams{
		Iterations: prelogin.Iterations, MemoryKB: prelogin.MemoryKB, Parallelism: prelogin.Parallelism,
	})
	if err != nil {
		return nil, err
	}
	defer derived.Zero()
	return append([]byte(nil), derived.StretchedKey...), nil
}

func zeroBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
