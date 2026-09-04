// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Decides which saved logins may be offered for a fill target.
 *
 * Host comparison is delegated to the shared module the browser extension
 * already uses, so both clients agree on what counts as the same site,
 * including the multi-tenant suffixes ("bar.github.io") that must never share
 * a credential.
 *
 * Two rules the native surface adds on top:
 *  - An app identifier is not a domain. It only matches an identifier the item
 *    was actually captured against, never a URI, or "com.evil.paypal" would
 *    pull up a PayPal login.
 *  - Only http(s) URIs are considered, so a javascript: or file: URI stored on
 *    a shared-vault item cannot become a fill target.
 */

import {
  safeHost,
  hostMatches,
  domainMatches,
  isSafeHttpUri,
} from "@vaultctl/shared/host";
import type { AutofillTarget } from "./AutofillTarget";
import type { AutofillCandidate, AutofillMatch } from "./AutofillCandidate";

export interface MatchOptions {
  /**
   * Allow a sibling subdomain to match (accounts.google.com for
   * mail.google.com). Off by default and opt-in per user, mirroring the
   * extension's relaxed-matching setting.
   */
  allowRelatedDomains?: boolean;
}

function matchWeb(
  candidate: AutofillCandidate,
  url: string,
  options: MatchOptions,
): AutofillMatch | null {
  const targetHost = safeHost(url);
  if (!targetHost) return null;

  const hosts = candidate.uris.filter(isSafeHttpUri).map(safeHost);
  if (hosts.some((host) => hostMatches(host, targetHost))) {
    return { candidate, strength: "exact" };
  }
  if (
    options.allowRelatedDomains &&
    hosts.some((host) => domainMatches(host, targetHost))
  ) {
    return { candidate, strength: "domain" };
  }
  return null;
}

function matchApp(
  candidate: AutofillCandidate,
  identifier: string,
): AutofillMatch | null {
  const wanted = identifier.trim().toLowerCase();
  if (!wanted) return null;

  const known = (candidate.appIdentifiers ?? []).map((id) =>
    id.trim().toLowerCase(),
  );
  return known.includes(wanted) ? { candidate, strength: "app" } : null;
}

const STRENGTH_ORDER: Record<AutofillMatch["strength"], number> = {
  exact: 0,
  app: 1,
  domain: 2,
};

/**
 * Candidates the OS may be offered for this target, strongest first. An empty
 * result means offer nothing: guessing is how a credential ends up in the
 * wrong app.
 */
export function matchCandidates(
  target: AutofillTarget,
  candidates: AutofillCandidate[],
  options: MatchOptions = {},
): AutofillMatch[] {
  const matches: AutofillMatch[] = [];

  for (const candidate of candidates) {
    const match =
      target.kind === "web"
        ? matchWeb(candidate, target.url, options)
        : matchApp(candidate, target.identifier);
    if (match) matches.push(match);
  }

  return matches.sort((left, right) => {
    const byStrength =
      STRENGTH_ORDER[left.strength] - STRENGTH_ORDER[right.strength];
    if (byStrength !== 0) return byStrength;
    return left.candidate.name.localeCompare(right.candidate.name);
  });
}
