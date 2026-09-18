// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"strings"
	"testing"
)

func TestParseGitCredentialQuery(t *testing.T) {
	query := parseGitCredentialQuery(strings.NewReader("protocol=https\nhost=github.com\npath=vineethkrishnan/vaultctl.git\nusername=vineeth\n\nignored=after-blank\n"))
	if query.Protocol != "https" || query.Host != "github.com" || query.Username != "vineeth" {
		t.Errorf("parsed %+v", query)
	}
	if got := parseGitCredentialQuery(strings.NewReader("protocol=https\nhost=github.com")); got.Host != "github.com" {
		t.Errorf("EOF without blank line: %+v", got)
	}
	if got := parseGitCredentialQuery(strings.NewReader("garbage\nhost=x\n")); got.Host != "" {
		t.Errorf("malformed line should end the block: %+v", got)
	}
}

func TestGitCredential_StoreAndEraseAreNoOps(t *testing.T) {
	for _, action := range []string{"store", "erase"} {
		cmd := newGitCredentialCmd()
		cmd.SetIn(strings.NewReader("protocol=https\nhost=github.com\nusername=x\npassword=y\n"))
		var out strings.Builder
		cmd.SetOut(&out)
		cmd.SetArgs([]string{action})
		if err := cmd.Execute(); err != nil {
			t.Fatalf("%s: %v", action, err)
		}
		if out.Len() != 0 {
			t.Errorf("%s wrote %q", action, out.String())
		}
	}
}

func TestGitCredential_GetIgnoresNonHTTPS(t *testing.T) {
	t.Setenv(envAPIKey, "")
	cmd := newGitCredentialCmd()
	cmd.SetIn(strings.NewReader("protocol=ssh\nhost=github.com\n"))
	var out strings.Builder
	cmd.SetOut(&out)
	cmd.SetArgs([]string{"get"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if out.Len() != 0 {
		t.Errorf("ssh query answered: %q", out.String())
	}
}
