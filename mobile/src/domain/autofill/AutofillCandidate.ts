// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A vault item reduced to what matching needs. The autofill extension runs in
 * its own process against the decrypted cache, so this deliberately carries no
 * secret material - only what decides whether an item is offered.
 */
export interface AutofillCandidate {
  itemId: string;
  vaultId: string;
  name: string;
  username: string;
  uris: string[];
  /** Android package names / iOS bundle ids this item was captured from. */
  appIdentifiers?: string[];
}

export type MatchStrength = "exact" | "domain" | "app";

export interface AutofillMatch {
  candidate: AutofillCandidate;
  strength: MatchStrength;
}
