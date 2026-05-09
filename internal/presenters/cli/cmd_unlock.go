// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/vineethkrishnan/vaultctl/internal/application/clientcrypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func newUnlockCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "unlock",
		Short: "Re-prompt for master password and validate the cached session",
		Long: `Re-prompt for the master password, re-derive the stretched key, and
validate it against the cached encrypted private key.

On the CLI this is a single-shot check — the stretched key cannot survive
across processes — but it is useful for catching "did I remember my master
password?" without running a destructive command.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			session, err := LoadSession()
			if errors.Is(err, ErrNoSession) {
				return ErrNoSession
			}
			if err != nil {
				return err
			}
			if session.APIKey != "" {
				return errors.New("cannot unlock: running in VAULTCTL_API_KEY mode")
			}

			// Refetch prelogin so we use the user's current KDF params.
			preloginRaw, err := httpGet("/auth/prelogin?email="+urlQueryEscape(session.Email), nil)
			if err != nil {
				return err
			}
			var prelogin struct {
				Salt        string `json:"salt"`
				Iterations  uint32 `json:"iterations"`
				MemoryKB    uint32 `json:"memoryKB"`
				Parallelism uint8  `json:"parallelism"`
			}
			if err := unmarshalJSON(preloginRaw, &prelogin); err != nil {
				return err
			}
			salt, err := base64.StdEncoding.DecodeString(prelogin.Salt)
			if err != nil {
				return err
			}
			password, err := promptPassword("Master password")
			if err != nil {
				return err
			}
			derived, err := clientcrypto.DeriveKeys(password, salt, user.KDFParams{
				Iterations: prelogin.Iterations, MemoryKB: prelogin.MemoryKB, Parallelism: prelogin.Parallelism,
			})
			if err != nil {
				return err
			}
			defer derived.Zero()

			keys, err := unlockKeys(session, derived.StretchedKey)
			if err != nil {
				return err
			}
			defer keys.Zero()

			if isJSON(cmd) {
				return printJSON(cmd, map[string]string{"status": "unlocked"})
			}
			_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Master password verified — vault unlocked for this process.")
			return nil
		},
	}
}
