// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/vineethkrishnan/vaultctl/internal/application/clientcrypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

func newLoginCmd() *cobra.Command {
	var email, deviceName string
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Authenticate with email + master password and cache a session",
		RunE: func(cmd *cobra.Command, _ []string) error {
			// API-key mode: no interactive prompt, no password derivation.
			if os.Getenv(envAPIKey) != "" {
				session := &Session{APIKey: os.Getenv(envAPIKey)}
				if isJSON(cmd) {
					return printJSON(cmd, map[string]string{"status": "api-key-mode"})
				}
				_ = session
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), "VAULTCTL_API_KEY detected - using API-key auth (no password prompt).")
				return nil
			}

			// Collect credentials.
			if email == "" {
				value, err := promptString("Email", func(s string) error {
					if s == "" {
						return errors.New("email cannot be empty")
					}
					return nil
				})
				if err != nil {
					return err
				}
				email = value
			}
			password, err := promptPassword("Master password")
			if err != nil {
				return err
			}

			// Step 1: prelogin - fetches salt + KDF params.
			preloginRaw, err := httpGet("/auth/prelogin?email="+urlQueryEscape(email), nil)
			if err != nil {
				return err
			}
			var prelogin struct {
				Salt        string `json:"salt"`
				Iterations  uint32 `json:"iterations"`
				MemoryKB    uint32 `json:"memoryKB"`
				Parallelism uint8  `json:"parallelism"`
			}
			if err := json.Unmarshal(preloginRaw, &prelogin); err != nil {
				return fmt.Errorf("decode prelogin: %w", err)
			}
			salt, err := base64.StdEncoding.DecodeString(prelogin.Salt)
			if err != nil {
				return fmt.Errorf("decode salt: %w", err)
			}

			// Step 2: derive keys locally.
			params := user.KDFParams{
				Iterations:  prelogin.Iterations,
				MemoryKB:    prelogin.MemoryKB,
				Parallelism: prelogin.Parallelism,
			}
			derived, err := clientcrypto.DeriveKeys(password, salt, params)
			if err != nil {
				return err
			}
			defer derived.Zero()

			// Step 3: POST /auth/login with the auth hash.
			loginReq := map[string]string{
				"email":      email,
				"authHash":   base64.StdEncoding.EncodeToString(derived.AuthHash),
				"deviceName": deviceName,
			}
			loginRaw, err := httpPost("/auth/login", loginReq, nil)
			if err != nil {
				return err
			}
			var loginResp struct {
				UserID                      string `json:"userId"`
				Role                        string `json:"role"`
				AccessToken                 string `json:"accessToken"`
				RefreshToken                string `json:"refreshToken"`
				RefreshExpiresAt            string `json:"refreshExpiresAt"`
				EncryptedPrivateKey         string `json:"encryptedPrivateKey"`
				EncryptedIdentityPrivateKey string `json:"encryptedIdentityPrivateKey"`
				PublicKey                   string `json:"publicKey"`
				IdentityPublicKey           string `json:"identityPublicKey"`
				Vaults                      []struct {
					VaultID           string `json:"vaultId"`
					VaultName         string `json:"vaultName"`
					VaultType         string `json:"vaultType"`
					EncryptedVaultKey string `json:"encryptedVaultKey"`
					SenderID          string `json:"senderId"`
					Role              string `json:"role"`
				} `json:"vaults"`
			}
			if err := json.Unmarshal(loginRaw, &loginResp); err != nil {
				return fmt.Errorf("decode login: %w", err)
			}

			// Step 4: shape + persist session.
			session := &Session{
				UserID:                      loginResp.UserID,
				Email:                       email,
				Role:                        loginResp.Role,
				AccessToken:                 loginResp.AccessToken,
				RefreshToken:                loginResp.RefreshToken,
				RefreshExpiresAt:            loginResp.RefreshExpiresAt,
				EncryptedPrivateKey:         loginResp.EncryptedPrivateKey,
				EncryptedIdentityPrivateKey: loginResp.EncryptedIdentityPrivateKey,
				PublicKey:                   loginResp.PublicKey,
				IdentityPublicKey:           loginResp.IdentityPublicKey,
			}
			session.Vaults = make([]SessionVault, 0, len(loginResp.Vaults))
			for _, v := range loginResp.Vaults {
				session.Vaults = append(session.Vaults, SessionVault{
					ID:                v.VaultID,
					Name:              v.VaultName,
					Type:              v.VaultType,
					Role:              v.Role,
					EncryptedVaultKey: v.EncryptedVaultKey,
					SenderID:          v.SenderID,
				})
			}
			if len(session.Vaults) == 1 {
				session.ActiveVaultID = session.Vaults[0].ID
			}
			if err := SaveSession(session); err != nil {
				return err
			}

			if isJSON(cmd) {
				return printJSON(cmd, map[string]any{
					"status": "ok", "userId": session.UserID,
					"email": session.Email, "vaultCount": len(session.Vaults),
				})
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Logged in as %s (%d vault(s))\n", session.Email, len(session.Vaults))
			return nil
		},
	}
	cmd.Flags().StringVar(&email, "email", "", "Email address (prompted if omitted)")
	cmd.Flags().StringVar(&deviceName, "device", "vaultctl-cli", "Device label recorded on the server session")
	return cmd
}

// urlQueryEscape is a tiny helper so we don't import net/url here just for a
// one-liner. Only called with user-supplied emails which are already shell
// escaped.
func urlQueryEscape(s string) string {
	// Minimal safe encoding - vaultctl emails are RFC 5322 compliant and
	// never contain '#', '?' or '&' without upstream validation already
	// rejecting them, but we do encode '+' defensively.
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '+':
			out = append(out, '%', '2', 'B')
		case ' ':
			out = append(out, '%', '2', '0')
		default:
			out = append(out, c)
		}
	}
	return string(out)
}
