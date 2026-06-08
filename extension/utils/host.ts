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

// A compact effective-TLD list. NOT the full Mozilla PSL - it covers the common
// ccTLD second levels PLUS the multi-tenant hosting platforms that MUST be
// treated as public suffixes, or relaxed matching would leak a credential saved
// on one tenant (foo.github.io) to another (bar.github.io). Each entry is a
// suffix BELOW which a registrable name is one extra label to the left. Only
// consulted by the OPT-IN relaxed matcher, never the strict default.
const KNOWN_SUFFIXES = new Set([
  // ccTLD second levels
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
  "co.nz", "net.nz", "org.nz", "govt.nz",
  "co.jp", "or.jp", "ne.jp", "go.jp", "ac.jp",
  "com.br", "net.br", "org.br", "gov.br",
  "co.in", "net.in", "org.in", "gen.in", "firm.in", "ind.in",
  "co.za", "org.za", "net.za", "gov.za",
  "co.kr", "or.kr", "com.sg", "com.mx", "com.tr", "com.cn",
  "com.hk", "com.tw", "com.ar",
  // Multi-tenant hosting platforms: a subdomain is a SEPARATE site/owner, so
  // these are effective TLDs (cross-tenant fill must never happen).
  "github.io", "gitlab.io", "herokuapp.com", "vercel.app", "netlify.app",
  "netlify.com", "pages.dev", "workers.dev", "web.app", "firebaseapp.com",
  "appspot.com", "blogspot.com", "wordpress.com", "azurewebsites.net",
  "cloudfront.net", "translate.goog", "s3.amazonaws.com",
  "glitch.me", "onrender.com", "fly.dev", "surge.sh", "github.dev",
]);

// Number of right-most labels that form the public suffix of a host.
function publicSuffixLength(labels: string[]): number {
  for (let take = Math.min(labels.length - 1, 3); take >= 2; take--) {
    if (KNOWN_SUFFIXES.has(labels.slice(-take).join("."))) return take;
  }
  return 1;
}

// The registrable domain (eTLD+1) of a host, e.g. "mail.google.com" ->
// "google.com", "shop.foo.co.uk" -> "foo.co.uk", and "bar.github.io" ->
// "bar.github.io" (each platform tenant isolated). Port and a leading "www."
// are stripped; IPv4 literals and single-label hosts are returned unchanged.
export function registrableDomain(host: string): string {
  const clean = stripWww((host.split(":")[0] ?? host)).toLowerCase();
  const labels = clean.split(".").filter(Boolean);
  if (labels.length <= 2) return clean;
  if (labels.every((label) => /^\d+$/.test(label))) return clean; // IPv4
  const suffixLength = publicSuffixLength(labels);
  return labels.slice(-(suffixLength + 1)).join(".");
}

// True when two hosts share a registrable domain (so "accounts.google.com" and
// "mail.google.com" match). Looser than hostMatches - only used behind the
// opt-in relaxed-matching setting.
export function domainMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  const domainA = registrableDomain(a);
  return !!domainA && domainA === registrableDomain(b);
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
