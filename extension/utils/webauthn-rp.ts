// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Relying-party ID validation.
 *
 * A page tells us which rpId it wants a passkey for, and a content script
 * matches <all_urls>, so that claim is attacker-controlled. The background
 * re-derives the host from sender.tab.url and checks the claim against it
 * before any credential is created or used, the same way fillCredential and
 * generateTotp re-derive the host before releasing plaintext.
 *
 * WebAuthn's rule: an rpId must equal the origin's effective domain or be a
 * registrable suffix of it. So evil.com may claim "evil.com", and
 * "login.evil.com" may claim "evil.com", but neither can ever claim
 * "google.com". Note this is deliberately stricter than the extension's
 * relaxed-match setting - it ignores it entirely, and never strips "www.",
 * because the spec treats www.example.com and example.com as distinct
 * effective domains.
 */

import { isPublicSuffix, safeHostname } from "./host";

export function isRpIdAllowed(rpId: string, tabUrl: string): boolean {
  const host = safeHostname(tabUrl).trim().toLowerCase();
  const id = rpId.trim().toLowerCase();

  if (!host || !id) return false;
  if (id.includes(":") || id.includes("/")) return false;
  if (isIpLiteral(host) || isIpLiteral(id)) return false;
  if (isPublicSuffix(id)) return false;

  return id === host || host.endsWith(`.${id}`);
}

/** The effective rpId when a relying party does not supply one. */
export function defaultRpId(tabUrl: string): string {
  return safeHostname(tabUrl).trim().toLowerCase();
}

function isIpLiteral(host: string): boolean {
  if (host.includes(":")) return true;
  const labels = host.split(".");
  return labels.length === 4 && labels.every((label) => /^\d{1,3}$/.test(label));
}
