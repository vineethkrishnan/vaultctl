// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Config is the persistent CLI configuration, so a server chosen once with
// `vaultctl login --server` or `vaultctl config set` works in every shell
// without environment variables. Environment variables still win when set.
type Config struct {
	Server             string `json:"server,omitempty"`
	InsecureSkipVerify *bool  `json:"insecureSkipVerify,omitempty"`
}

const (
	envInsecureSkipVerify = "VAULTCTL_INSECURE_SKIP_VERIFY"
	configKeyServer       = "server"
	configKeyInsecure     = "insecure-skip-verify"
)

var (
	configMu     sync.Mutex
	cachedPath   string
	cachedConfig Config
)

func configPath() (string, error) {
	if override := os.Getenv("VAULTCTL_CONFIG"); override != "" {
		return override, nil
	}
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "vaultctl", "config.json"), nil
}

// loadConfig reads the file once per process (per path); a missing or
// unreadable file is an empty config so the CLI keeps working from
// environment variables alone.
func loadConfig() Config {
	configMu.Lock()
	defer configMu.Unlock()
	path, err := configPath()
	if err != nil {
		return Config{}
	}
	if path == cachedPath {
		return cachedConfig
	}
	cachedPath, cachedConfig = path, Config{}
	raw, err := os.ReadFile(path) //nolint:gosec // G304: fixed path under the user config dir
	if err != nil {
		return cachedConfig
	}
	_ = json.Unmarshal(raw, &cachedConfig)
	return cachedConfig
}

func saveConfig(config Config) error {
	path, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil { //nolint:gosec // G703: fixed path under the user config dir
		return err
	}
	raw, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return err
	}
	configMu.Lock()
	cachedPath, cachedConfig = path, config
	configMu.Unlock()
	return nil
}

// normalizeServerURL accepts what a user is likely to paste (a bare host,
// a URL with a path) and keeps only scheme://host[:port].
func normalizeServerURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", errors.New("server URL cannot be empty")
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "https://" + trimmed
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return "", fmt.Errorf("invalid server URL %q", raw)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", fmt.Errorf("server URL must be http or https, got %q", parsed.Scheme)
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

// isLoopbackServer reports whether the configured server is on this
// machine, the one case where a self-signed certificate is expected.
func isLoopbackServer(serverURL string) bool {
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
