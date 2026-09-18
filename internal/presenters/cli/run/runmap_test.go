// SPDX-License-Identifier: AGPL-3.0-or-later

package run

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSignature(t *testing.T) {
	a := Signature([]string{"/usr/bin/mysql", "-h", "db", "-uroot", "-psecret"}, []string{"secret"})
	b := Signature([]string{"mysql", "-uroot", "-h", "db"}, nil)
	if a != b {
		t.Errorf("order and inline secret should not matter: %q vs %q", a, b)
	}
	if Signature([]string{"mysql", "-psecret"}, []string{"secret"}) != "mysql " {
		t.Error("secret-bearing argument must be dropped")
	}
	if Signature(nil, nil) != "" {
		t.Error("empty argv")
	}
}

func TestRunMap_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)
	t.Setenv("HOME", dir)

	runMap, err := LoadRunMap()
	if err != nil {
		t.Fatal(err)
	}
	if got := runMap.Get("tsh login"); got != "" {
		t.Errorf("fresh map should be empty, got %q", got)
	}
	if err := runMap.Set("tsh login", "item-1"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(runMap.path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("perm = %o", info.Mode().Perm())
	}
	if !filepath.IsAbs(runMap.path) || filepath.Base(runMap.path) != "run-map.json" {
		t.Errorf("unexpected path %s", runMap.path)
	}
	again, err := LoadRunMap()
	if err != nil {
		t.Fatal(err)
	}
	if got := again.Get("tsh login"); got != "item-1" {
		t.Errorf("reload: got %q", got)
	}
}
