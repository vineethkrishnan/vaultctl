// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"bufio"
	"fmt"
	"io"
	"strings"

	"github.com/spf13/cobra"
)

// gitCredentialQuery is the key=value block git writes to a credential
// helper's stdin (see git-credential(1)).
type gitCredentialQuery struct {
	Protocol string
	Host     string
	Username string
}

func newGitCredentialCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "git-credential <get|store|erase>",
		Short: "Act as a git credential helper backed by the vault",
		Long: `Answer git's credential requests from the vault, so https clones, fetches
and pushes never prompt. Wire it up once with:

  git config --global credential.helper '!vaultctl git-credential'

git calls "get" with the protocol and host on stdin; the matching login is
looked up the same way the browser extension matches sites and returned
as username and password. "store" and "erase" are accepted and ignored,
so git never writes anything back and a rejected credential is not
deleted from the vault. Only https hosts are answered.`,
		Args:      cobra.ExactArgs(1),
		ValidArgs: []string{"get", "store", "erase"},
		RunE: func(cmd *cobra.Command, args []string) error {
			if args[0] != "get" {
				return nil
			}
			query := parseGitCredentialQuery(cmd.InOrStdin())
			if query.Protocol != "https" || query.Host == "" {
				return nil
			}
			session, err := LoadSession()
			if err != nil {
				printErr("vaultctl: " + err.Error())
				return nil
			}
			keys, err := deriveSessionKeys(session)
			if err != nil {
				printErr("vaultctl: " + err.Error())
				return nil
			}
			defer keys.Zero()
			matches, err := findLoginsForHost(session, keys, query.Host, query.Username)
			if err != nil {
				printErr("vaultctl: " + err.Error())
				return nil
			}
			if len(matches) == 0 {
				return nil
			}
			if len(matches) > 1 {
				printErr(fmt.Sprintf("vaultctl: %d logins match %s; git will use %q", len(matches), query.Host, matches[0].Name))
			}
			data := matches[0].Data
			out := cmd.OutOrStdout()
			_, _ = fmt.Fprintf(out, "username=%s\n", data.Username)
			_, _ = fmt.Fprintf(out, "password=%s\n", data.Password)
			return nil
		},
	}
}

// parseGitCredentialQuery reads key=value lines up to a blank line or EOF.
// Unknown keys are ignored, and a malformed line ends the block.
func parseGitCredentialQuery(in io.Reader) gitCredentialQuery {
	var query gitCredentialQuery
	scanner := bufio.NewScanner(in)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			break
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			break
		}
		switch key {
		case "protocol":
			query.Protocol = value
		case "host":
			query.Host = value
		case "username":
			query.Username = value
		}
	}
	return query
}
