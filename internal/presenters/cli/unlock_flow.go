// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/clientcrypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// deriveSessionKeys prompts for the master password, re-runs prelogin +
// Argon2id, unwraps the RSA private key + every vault key. It is the shared
// path used by list/get/create/edit/delete/totp/unlock.
//
// API-key mode is rejected because those commands need access to plaintext
// vault items which requires the master password.
func deriveSessionKeys(session *Session) (*Keys, error) {
	if session.APIKey != "" {
		return nil, errors.New("this command requires a master-password session; VAULTCTL_API_KEY alone cannot decrypt vault items")
	}
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

	return unlockKeys(session, derived.StretchedKey)
}
