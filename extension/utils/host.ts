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

// A compact public-suffix list: second-level suffixes under which the
// registrable name is the THIRD label from the right (e.g. "co.uk" -> the
// registrable domain of "foo.co.uk" is "foo.co.uk", not "co.uk"). Not
// exhaustive - covers the common ccTLD second levels - and only consulted for
// the OPT-IN relaxed matcher, never the strict default.
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
  "co.nz", "net.nz", "org.nz", "govt.nz",
  "co.jp", "or.jp", "ne.jp", "go.jp", "ac.jp",
  "com.br", "net.br", "org.br", "gov.br",
  "co.in", "net.in", "org.in", "gen.in", "firm.in", "ind.in",
  "co.za", "org.za", "net.za", "gov.za",
  "co.kr", "or.kr", "com.sg", "com.mx", "com.tr", "com.cn",
  "com.hk", "com.tw", "com.ar",
]);

// The registrable domain (eTLD+1) of a host, e.g. "mail.google.com" ->
// "google.com" and "shop.foo.co.uk" -> "foo.co.uk". Port and a leading "www."
// are stripped; IPv4 literals and single-label hosts are returned unchanged.
export function registrableDomain(host: string): string {
  const clean = stripWww((host.split(":")[0] ?? host)).toLowerCase();
  const labels = clean.split(".").filter(Boolean);
  if (labels.length <= 2) return clean;
  if (labels.every((label) => /^\d+$/.test(label))) return clean; // IPv4
  const lastTwo = labels.slice(-2).join(".");
  const take = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join(".");
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
