// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"strings"
	"testing"
)

func TestShellInit(t *testing.T) {
	t.Setenv(envRunPrograms, "tsh mysql")
	for shell, want := range map[string]string{
		"zsh":  "alias tsh='vaultctl run -- tsh'\nalias mysql='vaultctl run -- mysql'\n",
		"fish": "alias tsh 'vaultctl run -- tsh'\nalias mysql 'vaultctl run -- mysql'\n",
	} {
		cmd := newShellInitCmd()
		var out strings.Builder
		cmd.SetOut(&out)
		cmd.SetArgs([]string{shell})
		if err := cmd.Execute(); err != nil {
			t.Fatalf("%s: %v", shell, err)
		}
		if out.String() != want {
			t.Errorf("%s: got %q want %q", shell, out.String(), want)
		}
	}
	t.Setenv(envRunPrograms, "")
	cmd := newShellInitCmd()
	var out strings.Builder
	cmd.SetOut(&out)
	cmd.SetArgs([]string{"bash"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "alias ssh='vaultctl run -- ssh'") {
		t.Errorf("default list missing ssh: %q", out.String())
	}
	cmd = newShellInitCmd()
	cmd.SetArgs([]string{"powershell"})
	if err := cmd.Execute(); err == nil {
		t.Error("unsupported shell should fail")
	}
}
