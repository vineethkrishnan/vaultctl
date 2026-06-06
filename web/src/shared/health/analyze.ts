// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure password-health analysis over already-decrypted login items. All of this
 * runs in the browser; no plaintext, hash, or score ever leaves the client.
 *
 * The zxcvbn scorer is injected so this module stays a pure, synchronously
 * testable function and the heavy wordlist only loads in the actual UI.
 */

export interface HealthInput {
  id: string;
  vaultId: string;
  name: string;
  username: string;
  password: string;
  updatedAt: string;
}

export interface HealthItemRef {
  id: string;
  vaultId: string;
  name: string;
  username: string;
}

export type HealthIssue = "weak" | "reused" | "stale";

export interface WeakEntry extends HealthItemRef {
  score: number;
}

export interface ReusedGroup {
  fingerprint: string;
  items: HealthItemRef[];
}

export interface StaleEntry extends HealthItemRef {
  updatedAt: string;
  ageDays: number;
}

export interface HealthReport {
  total: number;
  withPassword: number;
  weak: WeakEntry[];
  reused: ReusedGroup[];
  stale: StaleEntry[];
  reusedItemCount: number;
}

/** zxcvbn-style score 0-4; <= this is treated as weak. */
export const WEAK_SCORE_THRESHOLD = 2;

/** Logins older than this are flagged as stale (~12 months). */
export const STALE_AGE_DAYS = 365;

const DAY_MS = 86_400_000;

export type PasswordScorer = (password: string) => number;

function toRef(input: HealthInput): HealthItemRef {
  return {
    id: input.id,
    vaultId: input.vaultId,
    name: input.name,
    username: input.username,
  };
}

/**
 * Group passwords that are byte-identical. The caller supplies a stable
 * fingerprint (e.g. a SHA-256 hex digest) so the raw password never has to be
 * retained or compared in cleartext across the report.
 */
export function groupReused(
  inputs: readonly HealthInput[],
  fingerprints: ReadonlyMap<string, string>,
): ReusedGroup[] {
  const byFingerprint = new Map<string, HealthItemRef[]>();
  for (const input of inputs) {
    if (!input.password) continue;
    const fingerprint = fingerprints.get(input.id);
    if (!fingerprint) continue;
    const bucket = byFingerprint.get(fingerprint) ?? [];
    bucket.push(toRef(input));
    byFingerprint.set(fingerprint, bucket);
  }

  const groups: ReusedGroup[] = [];
  for (const [fingerprint, items] of byFingerprint) {
    if (items.length > 1) groups.push({ fingerprint, items });
  }
  groups.sort((a, b) => b.items.length - a.items.length);
  return groups;
}

export function findWeak(
  inputs: readonly HealthInput[],
  scorer: PasswordScorer,
  threshold = WEAK_SCORE_THRESHOLD,
): WeakEntry[] {
  const weak: WeakEntry[] = [];
  for (const input of inputs) {
    if (!input.password) continue;
    const score = scorer(input.password);
    if (score <= threshold) weak.push({ ...toRef(input), score });
  }
  weak.sort((a, b) => a.score - b.score);
  return weak;
}

export function findStale(
  inputs: readonly HealthInput[],
  now = Date.now(),
  maxAgeDays = STALE_AGE_DAYS,
): StaleEntry[] {
  const stale: StaleEntry[] = [];
  for (const input of inputs) {
    if (!input.password) continue;
    const updated = Date.parse(input.updatedAt);
    if (!Number.isFinite(updated)) continue;
    const ageDays = Math.floor((now - updated) / DAY_MS);
    if (ageDays >= maxAgeDays) {
      stale.push({ ...toRef(input), updatedAt: input.updatedAt, ageDays });
    }
  }
  stale.sort((a, b) => b.ageDays - a.ageDays);
  return stale;
}

export function analyzeHealth(
  inputs: readonly HealthInput[],
  scorer: PasswordScorer,
  fingerprints: ReadonlyMap<string, string>,
  now = Date.now(),
): HealthReport {
  const withPassword = inputs.filter((input) => !!input.password).length;
  const reused = groupReused(inputs, fingerprints);
  return {
    total: inputs.length,
    withPassword,
    weak: findWeak(inputs, scorer),
    reused,
    stale: findStale(inputs, now),
    reusedItemCount: reused.reduce((sum, group) => sum + group.items.length, 0),
  };
}
