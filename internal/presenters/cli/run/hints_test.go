// SPDX-License-Identifier: AGPL-3.0-or-later

package run

import (
	"reflect"
	"testing"
)

func TestRewrite(t *testing.T) {
	cases := []struct {
		name        string
		argv        []string
		username    string
		hasPassword bool
		want        []string
	}{
		{"tsh adds user", []string{"tsh", "login", "--proxy=t.example.com"}, "vineeth", true, []string{"tsh", "login", "--proxy=t.example.com", "--user=vineeth"}},
		{"tsh keeps explicit user", []string{"tsh", "login", "--user", "admin"}, "vineeth", true, []string{"tsh", "login", "--user", "admin"}},
		{"tsh non-login untouched", []string{"tsh", "ssh", "host"}, "vineeth", true, []string{"tsh", "ssh", "host"}},
		{"mysql adds user and prompt", []string{"mysql", "-h", "db"}, "root", true, []string{"mysql", "-uroot", "-h", "db", "-p"}},
		{"mysql keeps -u and -p", []string{"mysql", "-u", "app", "-p"}, "root", true, []string{"mysql", "-u", "app", "-p"}},
		{"mysql glued -pSECRET untouched", []string{"mysql", "-uapp", "-psecret"}, "root", true, []string{"mysql", "-uapp", "-psecret"}},
		{"mysql no password no prompt", []string{"mysql", "-h", "db"}, "root", false, []string{"mysql", "-uroot", "-h", "db"}},
		{"ssh adds -l", []string{"ssh", "web01"}, "deploy", true, []string{"ssh", "-l", "deploy", "web01"}},
		{"ssh keeps user@host", []string{"ssh", "ops@web01"}, "deploy", true, []string{"ssh", "ops@web01"}},
		{"psql adds -U", []string{"psql", "-h", "db"}, "app", true, []string{"psql", "-U", "app", "-h", "db"}},
		{"unknown program untouched", []string{"foo", "--host", "x"}, "u", true, []string{"foo", "--host", "x"}},
		{"no username no change", []string{"tsh", "login"}, "", true, []string{"tsh", "login"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Rewrite(tc.argv, ParseArgv(tc.argv), tc.username, tc.hasPassword)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestHasPasswordArg(t *testing.T) {
	if !HasPasswordArg([]string{"mysql", "-uroot", "-psecret"}) {
		t.Error("glued -p value")
	}
	if !HasPasswordArg([]string{"anything", "--password=x"}) {
		t.Error("--password=")
	}
	if HasPasswordArg([]string{"mysql", "-uroot", "-p"}) {
		t.Error("bare -p is a prompt request, not a password")
	}
	if HasPasswordArg([]string{"ssh", "-p", "2222", "host"}) {
		t.Error("ssh -p is a port")
	}
}
