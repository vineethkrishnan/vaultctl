// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "./base64url.js";

describe("base64url", () => {
  it("encodes without padding and with the url alphabet", () => {
    // 0xfb 0xff encodes as "+/8" in standard base64.
    expect(toBase64Url(Uint8Array.of(0xfb, 0xff))).toBe("-_8");
    expect(toBase64Url(new Uint8Array(0))).toBe("");
    expect(toBase64Url(Uint8Array.of(0))).toBe("AA");
  });

  it("round-trips every input length modulo 3", async () => {
    for (const length of [0, 1, 2, 3, 4, 5, 31, 32, 33]) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it("decodes input that already carries padding", () => {
    expect(fromBase64Url("-_8=")).toEqual(Uint8Array.of(0xfb, 0xff));
  });
});
