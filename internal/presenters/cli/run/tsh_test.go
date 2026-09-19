// SPDX-License-Identifier: AGPL-3.0-or-later

package run

import (
	"os"
	"path/filepath"
	"testing"
)

func fakeEnv(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func writeTshProfile(t *testing.T, dir, name, proxy, user string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, "current-profile"), []byte(name+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	body := "web_proxy_addr: " + proxy + "\nssh_proxy_addr: x:3023\nuser: " + user + "\n"
	if err := os.WriteFile(filepath.Join(dir, name+".yaml"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestTshTarget_FromProfileWhenArgvNamesNoProxy(t *testing.T) {
	dir := t.TempDir()
	writeTshProfile(t, dir, "teleport.locaboo.de", "teleport.locaboo.de:443", "vineeth")
	target := ParseArgvWithEnv([]string{"tsh", "ssh", "loyadmin@locaboo-stage"}, fakeEnv(map[string]string{"TELEPORT_HOME": dir}))
	host, ok := target.Host()
	if !ok || host != "teleport.locaboo.de" {
		t.Errorf("host = %q ok=%v", host, ok)
	}
	if target.Username() != "vineeth" {
		t.Errorf("username = %q; loyadmin is the node login, not the Teleport user", target.Username())
	}
}

func TestTshTarget_FlagsAndEnvBeatProfile(t *testing.T) {
	dir := t.TempDir()
	writeTshProfile(t, dir, "teleport.locaboo.de", "teleport.locaboo.de:443", "vineeth")
	env := fakeEnv(map[string]string{"TELEPORT_HOME": dir, "TELEPORT_PROXY": "env.example.com"})

	target := ParseArgvWithEnv([]string{"tsh", "login", "--proxy=https://flag.example.com", "--user", "admin"}, env)
	if host, _ := target.Host(); host != "flag.example.com" || target.Username() != "admin" {
		t.Errorf("flags should win: %+v", target)
	}
	target = ParseArgvWithEnv([]string{"tsh", "status"}, env)
	if host, _ := target.Host(); host != "env.example.com" || target.Username() != "vineeth" {
		t.Errorf("env proxy + profile user: %+v", target)
	}
}

func TestTshTarget_NoProfileNoHost(t *testing.T) {
	target := ParseArgvWithEnv([]string{"tsh", "ssh", "root@box"}, fakeEnv(map[string]string{"TELEPORT_HOME": t.TempDir()}))
	if _, ok := target.Host(); ok || len(target.Usernames) != 0 {
		t.Errorf("nothing to go on should yield nothing: %+v", target)
	}
}

func TestTshTarget_HomeFallback(t *testing.T) {
	home := t.TempDir()
	if err := os.Mkdir(filepath.Join(home, ".tsh"), 0o700); err != nil {
		t.Fatal(err)
	}
	writeTshProfile(t, filepath.Join(home, ".tsh"), "t.example.com", "t.example.com:443", "u")
	target := ParseArgvWithEnv([]string{"tsh", "ls"}, fakeEnv(map[string]string{"HOME": home}))
	if host, _ := target.Host(); host != "t.example.com" {
		t.Errorf("HOME/.tsh fallback: %+v", target)
	}
}
