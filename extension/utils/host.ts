// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Host parsing and matching shared across the extension.
 *
 * Matching stays strict (exact host incl. port) so a credential never fills on
 * the wrong site; the only allowance is stripping a leading "www." on both
 * sides so an apex domain and its "www" host are treated as the same origin.
 * No fuzzy registrable-domain / eTLD+1 matching.
 */

// Host including any non-default port (e.g. "locaboo.localhost:380"). A
// different port or subdomain counts as a different site.
export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

// True when two hosts refer to the same origin, treating apex and "www." as
// equal but keeping every other subdomain and any port distinct.
export function hostMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  return stripWww(a) === stripWww(b);
}

// Only http(s) URIs are safe to hand to window.open or to use as a fill/match
// target; javascript:/data:/file: from a shared-vault item must be rejected.
export function isSafeHttpUri(uri: string): boolean {
  try {
    const { protocol } = new URL(uri);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
