// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  analyzeHealth,
  findStale,
  findWeak,
  groupReused,
  STALE_AGE_DAYS,
  type HealthInput,
  type PasswordScorer,
} from "./analyze.js";

function input(overrides: Partial<HealthInput>): HealthInput {
  return {
    id: "id",
    vaultId: "v1",
    name: "Item",
    username: "user",
    password: "password",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// Cheap deterministic scorer: longer == stronger, capped at 4.
const lengthScorer: PasswordScorer = (pw) => Math.min(4, Math.floor(pw.length / 4));

describe("findWeak", () => {
  it("flags passwords at or below the threshold and sorts weakest first", () => {
    const items = [
      input({ id: "a", password: "abc" }), // score 0
      input({ id: "b", password: "abcdefgh" }), // score 2
      input({ id: "c", password: "abcdefghijklmnopqrst" }), // score 4
    ];
    const weak = findWeak(items, lengthScorer);
    expect(weak.map((w) => w.id)).toEqual(["a", "b"]);
    expect(weak[0]!.score).toBe(0);
  });

  it("ignores items without a password", () => {
    expect(findWeak([input({ password: "" })], lengthScorer)).toEqual([]);
  });
});

describe("groupReused", () => {
  it("groups items sharing a fingerprint and drops singletons", () => {
    const items = [
      input({ id: "a", password: "shared" }),
      input({ id: "b", password: "shared" }),
      input({ id: "c", password: "unique" }),
    ];
    const fingerprints = new Map([
      ["a", "fp-shared"],
      ["b", "fp-shared"],
      ["c", "fp-unique"],
    ]);
    const groups = groupReused(items, fingerprints);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("skips items with no password or no fingerprint", () => {
    const items = [input({ id: "a", password: "" }), input({ id: "b", password: "x" })];
    expect(groupReused(items, new Map([["b", "fp"]]))).toEqual([]);
  });
});

describe("findStale", () => {
  const now = Date.parse("2026-06-05T00:00:00Z");

  it("flags items older than the stale threshold", () => {
    const old = new Date(now - (STALE_AGE_DAYS + 10) * 86_400_000).toISOString();
    const fresh = new Date(now - 5 * 86_400_000).toISOString();
    const stale = findStale(
      [input({ id: "old", updatedAt: old }), input({ id: "fresh", updatedAt: fresh })],
      now,
    );
    expect(stale.map((s) => s.id)).toEqual(["old"]);
    expect(stale[0]!.ageDays).toBeGreaterThanOrEqual(STALE_AGE_DAYS);
  });
});

describe("analyzeHealth", () => {
  it("aggregates all three signals", () => {
    const now = Date.parse("2026-06-05T00:00:00Z");
    const old = new Date(now - (STALE_AGE_DAYS + 1) * 86_400_000).toISOString();
    const items = [
      input({ id: "a", password: "weak", updatedAt: old }),
      input({ id: "b", password: "weak" }),
      input({ id: "c", password: "" }),
    ];
    const fingerprints = new Map([
      ["a", "fp"],
      ["b", "fp"],
    ]);
    const report = analyzeHealth(items, lengthScorer, fingerprints, now);
    expect(report.total).toBe(3);
    expect(report.withPassword).toBe(2);
    expect(report.reused).toHaveLength(1);
    expect(report.reusedItemCount).toBe(2);
    expect(report.stale.map((s) => s.id)).toEqual(["a"]);
    expect(report.weak.length).toBe(2);
  });
});
