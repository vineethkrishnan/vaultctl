// SPDX-License-Identifier: AGPL-3.0-or-later

// Package updatecheck queries the GitHub Releases API for the latest vaultctl
// release and caches the result. The check is server-side and opt-in: clients
// (web app, extension) read the cached answer from the API and never contact
// GitHub themselves, so a self-hosted instance phones home at most once per
// cache window - and never at all when disabled.
package updatecheck

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Release is the subset of a GitHub release we surface to clients.
type Release struct {
	Version     string    // tag without a leading "v" (e.g. "1.10.0")
	Notes       string    // release body (markdown)
	URL         string    // html_url of the release
	PublishedAt time.Time // release publish time
}

// Checker fetches and caches the latest release. Safe for concurrent use.
type Checker struct {
	Repo       string           // "owner/name"
	HTTPClient *http.Client     // defaults to a 10s-timeout client
	TTL        time.Duration    // cache window; defaults to 6h
	Clock      func() time.Time // defaults to time.Now

	mu        sync.Mutex
	cached    *Release
	fetchedAt time.Time
}

func (c *Checker) now() time.Time {
	if c.Clock != nil {
		return c.Clock()
	}
	return time.Now()
}

func (c *Checker) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return &http.Client{Timeout: 10 * time.Second}
}

func (c *Checker) ttl() time.Duration {
	if c.TTL > 0 {
		return c.TTL
	}
	return 6 * time.Hour
}

// Latest returns the most recent release, served from cache within the TTL.
// On a fetch error it returns the last cached value when one exists, so a
// transient GitHub outage doesn't blank the update banner.
func (c *Checker) Latest(ctx context.Context) (Release, error) {
	c.mu.Lock()
	if c.cached != nil && c.now().Sub(c.fetchedAt) < c.ttl() {
		cached := *c.cached
		c.mu.Unlock()
		return cached, nil
	}
	c.mu.Unlock()

	rel, err := c.fetch(ctx)
	if err != nil {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.cached != nil {
			return *c.cached, nil
		}
		return Release{}, err
	}

	c.mu.Lock()
	c.cached = &rel
	c.fetchedAt = c.now()
	c.mu.Unlock()
	return rel, nil
}

func (c *Checker) fetch(ctx context.Context) (Release, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", c.Repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return Release{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "vaultctl-update-check")

	res, err := c.httpClient().Do(req)
	if err != nil {
		return Release{}, fmt.Errorf("github releases: %w", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return Release{}, fmt.Errorf("github releases: status %d", res.StatusCode)
	}

	var body struct {
		TagName     string `json:"tag_name"`
		HTMLURL     string `json:"html_url"`
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return Release{}, fmt.Errorf("decode github release: %w", err)
	}
	published, _ := time.Parse(time.RFC3339, body.PublishedAt)
	return Release{
		Version:     strings.TrimPrefix(body.TagName, "v"),
		Notes:       body.Body,
		URL:         body.HTMLURL,
		PublishedAt: published,
	}, nil
}

// Severity values returned by Severity.
const (
	SeverityMajor = "major"
	SeverityMinor = "minor"
	SeverityPatch = "patch"
	SeverityNone  = "none" // up to date or ahead
)

// Severity classifies the jump from current to latest as a Severity* value, or
// "" when either version is not parseable semver (e.g. a "dev" build).
func Severity(current, latest string) string {
	c, ok1 := parseSemver(current)
	l, ok2 := parseSemver(latest)
	if !ok1 || !ok2 {
		return ""
	}
	switch {
	case l[0] > c[0]:
		return SeverityMajor
	case l[0] < c[0]:
		return SeverityNone
	case l[1] > c[1]:
		return SeverityMinor
	case l[1] < c[1]:
		return SeverityNone
	case l[2] > c[2]:
		return SeverityPatch
	default:
		return SeverityNone
	}
}

// UpdateAvailable reports whether latest is a higher semver than current.
func UpdateAvailable(current, latest string) bool {
	switch Severity(current, latest) {
	case SeverityMajor, SeverityMinor, SeverityPatch:
		return true
	default:
		return false
	}
}

func parseSemver(v string) ([3]int, bool) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	// Drop any pre-release / build metadata (e.g. "1.2.3-rc1+build").
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return [3]int{}, false
	}
	var out [3]int
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return [3]int{}, false
		}
		out[i] = n
	}
	return out, true
}
