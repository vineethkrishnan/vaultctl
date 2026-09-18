// SPDX-License-Identifier: AGPL-3.0-or-later

package run

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// RunMap remembers which vault item answered a given command line, for
// commands whose arguments name no host or several, and for hosts with
// more than one saved login. It holds item ids only, never secrets.
type RunMap struct {
	path    string
	Entries map[string]string `json:"entries"`
}

func runMapPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "vaultctl", "run-map.json"), nil
}

// LoadRunMap reads the map, treating a missing file as empty.
func LoadRunMap() (*RunMap, error) {
	path, err := runMapPath()
	if err != nil {
		return nil, err
	}
	runMap := &RunMap{path: path, Entries: map[string]string{}}
	raw, err := os.ReadFile(path) //nolint:gosec // G304: fixed path under the user config dir
	if errors.Is(err, os.ErrNotExist) {
		return runMap, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, runMap); err != nil {
		return nil, err
	}
	if runMap.Entries == nil {
		runMap.Entries = map[string]string{}
	}
	return runMap, nil
}

func (m *RunMap) Get(signature string) string {
	return m.Entries[signature]
}

// Set records the item for a signature and writes the file with 0600.
func (m *RunMap) Set(signature, itemID string) error {
	m.Entries[signature] = itemID
	if err := os.MkdirAll(filepath.Dir(m.path), 0o700); err != nil { //nolint:gosec // G703: fixed path under the user config dir
		return err
	}
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.path, raw, 0o600)
}

// Signature identifies a command line independent of argument order. Any
// argument that contains one of the given secrets is dropped so a
// password passed inline never lands in the file.
func Signature(argv []string, secrets []string) string {
	if len(argv) == 0 {
		return ""
	}
	args := make([]string, 0, len(argv)-1)
	for _, token := range argv[1:] {
		if containsSecret(token, secrets) {
			continue
		}
		args = append(args, token)
	}
	sort.Strings(args)
	return filepath.Base(argv[0]) + " " + strings.Join(args, " ")
}

func containsSecret(token string, secrets []string) bool {
	for _, secret := range secrets {
		if secret != "" && strings.Contains(token, secret) {
			return true
		}
	}
	return false
}
