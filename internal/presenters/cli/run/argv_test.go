// SPDX-License-Identifier: AGPL-3.0-or-later

package run

import (
	"reflect"
	"testing"
)

func TestParseArgv(t *testing.T) {
	cases := []struct {
		name  string
		argv  []string
		hosts []string
		users []string
	}{
		{"tsh proxy flag", []string{"tsh", "login", "--proxy=teleport.locaboo.de"}, []string{"teleport.locaboo.de"}, nil},
		{"tsh proxy with port and user", []string{"/opt/homebrew/bin/tsh", "login", "--proxy", "teleport.locaboo.de:443", "--user=vineeth"}, []string{"teleport.locaboo.de"}, []string{"vineeth"}},
		{"mysql", []string{"mysql", "-h", "db.example.com", "-u", "root", "-p"}, []string{"db.example.com"}, []string{"root"}},
		{"mysql glued user and port", []string{"mysql", "-uroot", "-h", "127.0.0.1", "-P", "3307"}, []string{"127.0.0.1"}, []string{"root"}},
		{"ssh user@host", []string{"ssh", "deploy@web01.example.com"}, []string{"web01.example.com"}, []string{"deploy"}},
		{"ssh -l with ported host", []string{"ssh", "-l", "deploy", "-p", "2222", "bastion.example.com"}, []string{"bastion.example.com"}, []string{"deploy"}},
		{"git https url", []string{"git", "clone", "https://github.com/vineethkrishnan/vaultctl.git"}, []string{"github.com"}, nil},
		{"url with user and default port", []string{"curl", "https://alice@api.example.com:443/v1"}, []string{"api.example.com"}, []string{"alice"}},
		{"flag host beats bare file", []string{"mysql", "-h", "db.example.com", "dump.sql"}, []string{"db.example.com"}, nil},
		{"scp remote paths are not hosts", []string{"scp", "a.example.com:/x", "b.example.com:/y"}, nil, nil},
		{"two bare hosts stay ambiguous", []string{"ping-both", "a.example.com", "b.example.com"}, []string{"a.example.com", "b.example.com"}, nil},
		{"localhost with port", []string{"psql", "-h", "localhost:5432", "-U", "app"}, []string{"localhost:5432"}, []string{"app"}},
		{"nothing host-like", []string{"sudo", "ls", "-la", "/tmp"}, nil, nil},
		{"empty", nil, nil, nil},
	}
	noTsh := fakeEnv(map[string]string{"TELEPORT_HOME": t.TempDir()})
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseArgvWithEnv(tc.argv, noTsh)
			if !reflect.DeepEqual(got.Hosts, tc.hosts) {
				t.Errorf("hosts = %v, want %v", got.Hosts, tc.hosts)
			}
			if !reflect.DeepEqual(got.Usernames, tc.users) {
				t.Errorf("users = %v, want %v", got.Usernames, tc.users)
			}
		})
	}
}

func TestTarget_HostRequiresExactlyOne(t *testing.T) {
	if _, ok := ParseArgv([]string{"ping-both", "a.example.com", "b.example.com"}).Host(); ok {
		t.Error("two hosts should not resolve")
	}
	if _, ok := ParseArgv([]string{"sudo", "ls"}).Host(); ok {
		t.Error("no host should not resolve")
	}
	host, ok := ParseArgvWithEnv([]string{"tsh", "login", "--proxy=Teleport.Locaboo.DE"}, fakeEnv(nil)).Host()
	if !ok || host != "teleport.locaboo.de" {
		t.Errorf("host = %q ok=%v", host, ok)
	}
	if got := ParseArgv([]string{"tsh", "login"}).Program; got != "tsh" {
		t.Errorf("program = %q", got)
	}
}
