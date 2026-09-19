// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"net/url"
	"strings"
)

// safeHost mirrors web/src/shared/host/host.ts: the host (with any
// non-default port) of a URL, or the input itself when it does not parse as
// one, so a bare "db.example.com:3306" stored in an item's uri still matches.
func safeHost(raw string) string {
	trimmed := strings.TrimSpace(raw)
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return trimmed
	}
	return stripDefaultPort(parsed.Host, parsed.Scheme)
}

// stripDefaultPort drops ":443" for https and ":80" for http so a uri saved
// with an explicit default port matches a command line that omits it.
func stripDefaultPort(host, scheme string) string {
	switch strings.ToLower(scheme) {
	case "https":
		return strings.TrimSuffix(host, ":443")
	case "http":
		return strings.TrimSuffix(host, ":80")
	}
	return host
}

func stripWWW(host string) string {
	return strings.TrimPrefix(strings.ToLower(host), "www.")
}

// hostMatches is the strict matcher the extension uses by default: the apex
// and its "www." host are the same site, every other subdomain and any port
// is a different one.
func hostMatches(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	return stripWWW(a) == stripWWW(b)
}
