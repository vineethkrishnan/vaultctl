// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { encodeQR } from "./qr.js";

function isFinder(m: boolean[][], r0: number, c0: number): boolean {
  // 7x7 finder: dark border ring + 3x3 dark centre, light ring between.
  for (let dr = 0; dr < 7; dr++) {
    for (let dc = 0; dc < 7; dc++) {
      const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
      const expected = ring !== 2; // ring 0,1,3 dark; ring 2 light
      if (m[r0 + dr]![c0 + dc] !== expected) return false;
    }
  }
  return true;
}

describe("encodeQR", () => {
  it("picks the right version/size for the data length", () => {
    expect(encodeQR("HELLO", "M").length).toBe(21); // v1
    expect(encodeQR("X".repeat(60), "M").length).toBe(33); // v4
    expect(encodeQR("X".repeat(140), "M").length).toBe(49); // v8 (version info)
  });

  it("throws when data exceeds supported versions", () => {
    expect(() => encodeQR("X".repeat(400), "H")).toThrow();
  });

  it("places the three finder patterns at the corners", () => {
    const m = encodeQR("vaultctl", "M");
    const n = m.length;
    expect(isFinder(m, 0, 0)).toBe(true);
    expect(isFinder(m, 0, n - 7)).toBe(true);
    expect(isFinder(m, n - 7, 0)).toBe(true);
  });

  it("places the dark module at (size-8, 8)", () => {
    for (const ec of ["L", "M", "Q", "H"] as const) {
      const m = encodeQR("HELLO", ec);
      const n = m.length;
      expect(m[n - 8]![8]).toBe(true);
    }
  });

  it("lays a valid timing pattern between the finders", () => {
    const m = encodeQR("vaultctl", "M");
    const n = m.length;
    for (let i = 8; i < n - 8; i++) {
      expect(m[6]![i]).toBe(i % 2 === 0);
      expect(m[i]![6]).toBe(i % 2 === 0);
    }
  });

  it("is deterministic", () => {
    expect(encodeQR("vaultctl", "M")).toEqual(encodeQR("vaultctl", "M"));
  });
});
