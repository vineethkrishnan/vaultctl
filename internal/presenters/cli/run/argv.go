// SPDX-License-Identifier: AGPL-3.0-or-later

// Package run wraps an interactive command in a pseudo-terminal and answers
// its credential prompts from the vault, without knowing the program.
package run

import (
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Target is what the command line reveals about where the program is going
// to log in: the program name, every host-looking token and every
// username-looking token, so the caller can pick a vault item.
type Target struct {
	Program   string
	Hosts     []string
	Usernames []string
}

// Host returns the single host the command line names, or false when there
// is none or the tokens disagree.
func (t Target) Host() (string, bool) {
	if len(t.Hosts) != 1 {
		return "", false
	}
	return t.Hosts[0], true
}

// Username returns the first username-looking token, if any.
func (t Target) Username() string {
	if len(t.Usernames) == 0 {
		return ""
	}
	return t.Usernames[0]
}

var (
	usernameFlags = map[string]bool{
		"-u": true, "--user": true, "--username": true, "-l": true, "-U": true, "--login": true,
	}
	// A dotted name whose last label is alphabetic, or a name/IP with a port.
	dottedHostRe = regexp.MustCompile(`^(?i)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(:\d{1,5})?$`)
	ipv4HostRe   = regexp.MustCompile(`^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$`)
	portedHostRe = regexp.MustCompile(`^(?i)[a-z0-9]([a-z0-9-]*[a-z0-9])?:\d{1,5}$`)
	userAtHostRe = regexp.MustCompile(`^([^@/\s:]+)@(.+)$`)
)

// ParseArgv extracts the target from a command line. Values attached to a
// flag (`--proxy=host`, `-h host`) take precedence over bare positional
// tokens, because a positional dotted token is as likely to be a file name.
func ParseArgv(argv []string) Target {
	return ParseArgvWithEnv(argv, os.Getenv)
}

// ParseArgvWithEnv is ParseArgv with an explicit environment, for programs
// whose target comes from their own configuration rather than argv.
func ParseArgvWithEnv(argv []string, getenv func(string) string) Target {
	target := Target{}
	if len(argv) == 0 {
		return target
	}
	target.Program = filepath.Base(argv[0])
	if target.Program == "tsh" {
		return tshTarget(argv, getenv)
	}

	var flagged, bare []string
	addUser := func(user string) { target.Usernames = appendUnique(target.Usernames, user) }

	args := argv[1:]
	for index := 0; index < len(args); index++ {
		token := args[index]
		if !strings.HasPrefix(token, "-") || token == "-" {
			user, host := hostFromValue(token)
			addUser(user)
			bare = appendUnique(bare, host)
			continue
		}
		if name, value, joined := strings.Cut(token, "="); joined && strings.HasPrefix(token, "--") {
			if usernameFlags[name] {
				addUser(value)
				continue
			}
			user, host := hostFromValue(value)
			addUser(user)
			flagged = appendUnique(flagged, host)
			continue
		}
		if gluedUser, ok := strings.CutPrefix(token, "-u"); ok && gluedUser != "" && !strings.HasPrefix(token, "--") {
			addUser(gluedUser)
			continue
		}
		value, ok := nextValue(args, index)
		if !ok {
			continue
		}
		if usernameFlags[token] {
			addUser(value)
			index++
			continue
		}
		if user, host := hostFromValue(value); host != "" {
			addUser(user)
			flagged = appendUnique(flagged, host)
			index++
		}
	}
	if len(flagged) > 0 {
		target.Hosts = flagged
	} else {
		target.Hosts = bare
	}
	return target
}

// appendUnique adds value unless it is empty or already present
// (case-insensitively, since hosts are lowercased anyway).
func appendUnique(list []string, value string) []string {
	if value == "" {
		return list
	}
	for _, existing := range list {
		if strings.EqualFold(existing, value) {
			return list
		}
	}
	return append(list, value)
}

// nextValue returns the token after index when it looks like a flag value
// rather than another flag.
func nextValue(args []string, index int) (string, bool) {
	if index+1 >= len(args) {
		return "", false
	}
	value := args[index+1]
	if strings.HasPrefix(value, "-") {
		return "", false
	}
	return value, true
}

// hostFromValue recognises "scheme://user@host:port/path", "user@host" and
// bare "host[:port]" forms. Anything else yields an empty host.
func hostFromValue(value string) (user, host string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", ""
	}
	if strings.Contains(value, "://") {
		parsed, err := url.Parse(value)
		if err != nil || parsed.Host == "" {
			return "", ""
		}
		if parsed.User != nil {
			user = parsed.User.Username()
		}
		return user, stripDefaultPort(strings.ToLower(parsed.Host), parsed.Scheme)
	}
	if match := userAtHostRe.FindStringSubmatch(value); match != nil {
		if host, ok := bareHost(match[2]); ok {
			return match[1], host
		}
		return "", ""
	}
	host, _ = bareHost(value)
	return "", host
}

func bareHost(value string) (string, bool) {
	lower := strings.ToLower(value)
	if dottedHostRe.MatchString(lower) || ipv4HostRe.MatchString(lower) || portedHostRe.MatchString(lower) {
		return lower, true
	}
	if lower == "localhost" {
		return lower, true
	}
	return "", false
}

func stripDefaultPort(host, scheme string) string {
	switch strings.ToLower(scheme) {
	case "https":
		return strings.TrimSuffix(host, ":443")
	case "http":
		return strings.TrimSuffix(host, ":80")
	}
	return host
}
