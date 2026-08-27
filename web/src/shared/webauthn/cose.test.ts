// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { toCoseKey } from "./cose.js";

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("toCoseKey", () => {
  it("emits an ES256 EC2 key in canonical label order", () => {
    const x = new Uint8Array(32).fill(0xaa);
    const y = new Uint8Array(32).fill(0xbb);

    // a5                map(5)
    //   01 02           kty: EC2
    //   03 26           alg: ES256 (-7)
    //   20 01           crv: P-256
    //   21 5820 <x>     x coordinate
    //   22 5820 <y>     y coordinate
    expect(hex(toCoseKey({ x, y }))).toBe(
      "a5" +
        "0102" +
        "0326" +
        "2001" +
        "215820" + "aa".repeat(32) +
        "225820" + "bb".repeat(32),
    );
  });
});
