package cli

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"

	"github.com/spf13/cobra"
)

const (
	charsetLower   = "abcdefghijklmnopqrstuvwxyz"
	charsetUpper   = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	charsetDigits  = "0123456789"
	charsetSymbols = "!@#$%^&*()-_=+[]{};:,.<>?/~"
)

func newGenerateCmd() *cobra.Command {
	var (
		length    int
		noLower   bool
		noUpper   bool
		noDigits  bool
		noSymbols bool
	)
	cmd := &cobra.Command{
		Use:   "generate",
		Short: "Generate a random password (purely local, no server call)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if length < 4 {
				return errors.New("length must be at least 4")
			}
			alphabet := ""
			if !noLower {
				alphabet += charsetLower
			}
			if !noUpper {
				alphabet += charsetUpper
			}
			if !noDigits {
				alphabet += charsetDigits
			}
			if !noSymbols {
				alphabet += charsetSymbols
			}
			if alphabet == "" {
				return errors.New("at least one character class must be enabled")
			}
			password, err := randomString(alphabet, length)
			if err != nil {
				return err
			}
			if isJSON(cmd) {
				return printJSON(cmd, map[string]any{"password": password, "length": length})
			}
			_, _ = fmt.Fprintln(cmd.OutOrStdout(), password)
			return nil
		},
	}
	cmd.Flags().IntVarP(&length, "length", "l", 24, "Password length")
	cmd.Flags().BoolVar(&noLower, "no-lower", false, "Exclude lowercase letters")
	cmd.Flags().BoolVar(&noUpper, "no-upper", false, "Exclude uppercase letters")
	cmd.Flags().BoolVar(&noDigits, "no-digits", false, "Exclude digits")
	cmd.Flags().BoolVar(&noSymbols, "no-symbols", false, "Exclude symbols")
	return cmd
}

// randomString draws length characters from alphabet using crypto/rand so
// the result is free of modulo bias.
func randomString(alphabet string, length int) (string, error) {
	max := big.NewInt(int64(len(alphabet)))
	out := make([]byte, length)
	for i := range out {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = alphabet[idx.Int64()]
	}
	return string(out), nil
}
