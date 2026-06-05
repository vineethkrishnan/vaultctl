// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import "github.com/spf13/cobra"

// newClientCmds returns the client-facing commands from PRD §M10.
// Every command uses the in-process clientcrypto package so all crypto
// (Argon2id, AES-256-GCM, RSA-OAEP, HKDF) runs locally - the server only
// ever sees ciphertext and auth hashes, preserving the zero-knowledge
// contract from architecture §6.
func newClientCmds() []*cobra.Command {
	return []*cobra.Command{
		newLoginCmd(),
		newLogoutCmd(),
		newStatusCmd(),
		newListCmd(),
		newGetCmd(),
		newCreateCmd(),
		newEditCmd(),
		newDeleteCmd(),
		newTrashCmd(),
		newImportCmd(),
		newExportCmd(),
		newGenerateCmd(),
		newTotpCmd(),
		newLockCmd(),
		newUnlockCmd(),
	}
}
