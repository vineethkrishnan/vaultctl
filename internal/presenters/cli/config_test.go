// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func useTempConfig(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("VAULTCTL_CONFIG", path)
	t.Setenv(envServer, "")
	t.Setenv(envInsecureSkipVerify, "")
	return path
}

func TestNormalizeServerURL(t *testing.T) {
	cases := map[string]string{
		"vault.vinelab.in":                   "https://vault.vinelab.in",
		"https://vault.vinelab.in/":          "https://vault.vinelab.in",
		"https://vault.vinelab.in/login?x=1": "https://vault.vinelab.in",
		"http://localhost:8080":              "http://localhost:8080",
		"  https://vault.example.com:8443  ": "https://vault.example.com:8443",
	}
	for input, want := range cases {
		got, err := normalizeServerURL(input)
		if err != nil || got != want {
			t.Errorf("normalizeServerURL(%q) = %q, %v; want %q", input, got, err, want)
		}
	}
	for _, bad := range []string{"", "ftp://x", "://nope"} {
		if _, err := normalizeServerURL(bad); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
}

func TestConfig_ServerPrecedence(t *testing.T) {
	path := useTempConfig(t)
	if got := ServerURL(); got != defaultServerURL {
		t.Errorf("no file, no env: %q", got)
	}
	if err := saveConfig(Config{Server: "https://vault.example.com"}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("config file perm: %v %v", info, err)
	}
	if got := ServerURL(); got != "https://vault.example.com" {
		t.Errorf("from file: %q", got)
	}
	t.Setenv(envServer, "https://override.example.com")
	if got := ServerURL(); got != "https://override.example.com" {
		t.Errorf("env should win: %q", got)
	}
}

func TestInsecureSkipVerify_DefaultsToLoopbackOnly(t *testing.T) {
	useTempConfig(t)
	if !insecureSkipVerify() {
		t.Error("default server is localhost, verification should be skipped")
	}
	if err := saveConfig(Config{Server: "https://vault.example.com"}); err != nil {
		t.Fatal(err)
	}
	if insecureSkipVerify() {
		t.Error("public host must verify certificates by default")
	}
	yes := true
	if err := saveConfig(Config{Server: "https://vault.example.com", InsecureSkipVerify: &yes}); err != nil {
		t.Fatal(err)
	}
	if !insecureSkipVerify() {
		t.Error("config opt-in ignored")
	}
	t.Setenv(envInsecureSkipVerify, "0")
	if insecureSkipVerify() {
		t.Error("env should win over the file")
	}
}

func TestConfigCmd_SetShowUnset(t *testing.T) {
	useTempConfig(t)
	execute := func(args ...string) string {
		cmd := newConfigCmd()
		var out strings.Builder
		cmd.SetOut(&out)
		cmd.SetArgs(args)
		if err := cmd.Execute(); err != nil {
			t.Fatalf("%v: %v", args, err)
		}
		return out.String()
	}
	execute("set", "server", "vault.vinelab.in")
	execute("set", "insecure-skip-verify", "false")
	shown := execute("show")
	if !strings.Contains(shown, "https://vault.vinelab.in  (from config file)") || !strings.Contains(shown, "false  (from config file)") {
		t.Errorf("show: %q", shown)
	}
	execute("unset", "server")
	if !strings.Contains(execute("show"), defaultServerURL+"  (default)") {
		t.Error("unset did not clear the server")
	}
	cmd := newConfigCmd()
	cmd.SetArgs([]string{"set", "colour", "blue"})
	if err := cmd.Execute(); err == nil {
		t.Error("unknown key should fail")
	}
}
