// SPDX-License-Identifier: AGPL-3.0-or-later

package run

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// tshTarget resolves where tsh will authenticate. The proxy comes from
// --proxy, then TELEPORT_PROXY, then the profile tsh itself would use
// (~/.tsh/current-profile, or TELEPORT_HOME). The Teleport user comes from
// --user or that profile. A user@host argument is the login on the target
// node, never the Teleport credential, so it is ignored here.
func tshTarget(argv []string, getenv func(string) string) Target {
	target := Target{Program: "tsh"}
	var proxy, user string
	args := argv[1:]
	for index := 0; index < len(args); index++ {
		token := args[index]
		switch {
		case strings.HasPrefix(token, "--proxy="):
			proxy = strings.TrimPrefix(token, "--proxy=")
		case token == "--proxy":
			if value, ok := nextValue(args, index); ok {
				proxy = value
				index++
			}
		case strings.HasPrefix(token, "--user="):
			user = strings.TrimPrefix(token, "--user=")
		case token == "--user":
			if value, ok := nextValue(args, index); ok {
				user = value
				index++
			}
		}
	}
	if proxy == "" {
		proxy = getenv("TELEPORT_PROXY")
	}
	profileProxy, profileUser := tshProfile(getenv)
	if proxy == "" {
		proxy = profileProxy
	}
	if user == "" {
		user = getenv("TELEPORT_USER")
	}
	if user == "" {
		user = profileUser
	}
	if host := tshProxyHost(proxy); host != "" {
		target.Hosts = []string{host}
	}
	if user != "" {
		target.Usernames = []string{user}
	}
	return target
}

// tshProxyHost normalises "teleport.example.com:443" and
// "https://teleport.example.com" to the host the vault item's URI carries.
func tshProxyHost(proxy string) string {
	_, host := hostFromValue(proxy)
	return strings.TrimSuffix(host, ":443")
}

// tshProfile reads the current profile's web_proxy_addr and user. Missing
// files are not an error: tsh simply has no current login.
func tshProfile(getenv func(string) string) (proxy, user string) {
	dir := getenv("TELEPORT_HOME")
	if dir == "" {
		home := getenv("HOME")
		if home == "" {
			return "", ""
		}
		dir = filepath.Join(home, ".tsh")
	}
	current, err := os.ReadFile(filepath.Join(dir, "current-profile")) //nolint:gosec // G304: fixed file name under the tsh dir
	if err != nil {
		return "", ""
	}
	name := strings.TrimSpace(string(current))
	if name == "" {
		return "", ""
	}
	profile, err := os.Open(filepath.Join(dir, name+".yaml")) //nolint:gosec // G304: name comes from tsh's own current-profile file
	if err != nil {
		return name, ""
	}
	defer func() { _ = profile.Close() }()
	proxy = name
	scanner := bufio.NewScanner(profile)
	for scanner.Scan() {
		key, value, ok := strings.Cut(scanner.Text(), ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "web_proxy_addr":
			proxy = strings.TrimSpace(value)
		case "user":
			user = strings.TrimSpace(value)
		}
	}
	return proxy, user
}
