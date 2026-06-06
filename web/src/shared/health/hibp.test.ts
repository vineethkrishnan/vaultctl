// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { parseBreachCount } from "./hibp";

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
// prefix 5BAA6, suffix 1E4C9B93F3F0682250B6CF8331B7EE68FD8
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

const BODY = [
  "1CC93AEF7B58A1B631CB55BF3A3A3750285:3",
  `${SUFFIX}:9659365`,
  "FED8DBF4A92E3F1AC1D7B0A1F4A2D6A1B0C:0",
].join("\r\n");

describe("parseBreachCount", () => {
  it("returns the count for a matching suffix", () => {
    expect(parseBreachCount(BODY, SUFFIX)).toBe(9659365);
  });

  it("matches case-insensitively", () => {
    expect(parseBreachCount(BODY, SUFFIX.toLowerCase())).toBe(9659365);
  });

  it("returns 0 when the suffix is absent", () => {
    expect(parseBreachCount(BODY, "0000000000000000000000000000000000A")).toBe(0);
  });

  it("returns 0 for a padding line with a zero count", () => {
    expect(parseBreachCount(BODY, "FED8DBF4A92E3F1AC1D7B0A1F4A2D6A1B0C")).toBe(0);
  });

  it("ignores blank and malformed lines", () => {
    const messy = `\n\n${SUFFIX}:42\nnocolonhere\n`;
    expect(parseBreachCount(messy, SUFFIX)).toBe(42);
  });
});
