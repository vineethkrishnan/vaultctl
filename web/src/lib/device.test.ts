// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { isRealBrand, pickBrand, humanizeDeviceName } from "./device";

describe("isRealBrand", () => {
  // Every GREASE placeholder Chromium is known to inject; the letters always
  // spell "Not A Brand", the punctuation and spacing vary by build.
  const greaseVariants = [
    "Not;A=Brand", // Dia, and current Chromium
    "Not/A)Brand",
    " Not A;Brand",
    "(Not(A:Brand)",
    "Not?A_Brand",
    "Not.A.Brand",
    "Not_A Brand",
    ";Not A Brand",
    "Not A Brand",
  ];

  it("rejects every GREASE separator variant", () => {
    for (const brand of greaseVariants) {
      expect(isRealBrand(brand)).toBe(false);
    }
  });

  it("accepts real product brands", () => {
    for (const brand of ["Dia", "Chromium", "Google Chrome", "Microsoft Edge", "Opera"]) {
      expect(isRealBrand(brand)).toBe(true);
    }
  });
});

describe("pickBrand", () => {
  it("prefers the product brand over the generic Chromium engine name", () => {
    // Dia's client-hints order: GREASE, then Chromium, then the product.
    const dia = [
      { brand: "Not;A=Brand", version: "8.0.0.0" },
      { brand: "Chromium", version: "140.0.0.0" },
      { brand: "Dia", version: "15.0.0.0" },
    ];
    expect(pickBrand(dia)?.brand).toBe("Dia");
  });

  it("names Chrome and Edge by their product, not Chromium", () => {
    expect(
      pickBrand([
        { brand: " Not A;Brand", version: "99" },
        { brand: "Chromium", version: "142" },
        { brand: "Google Chrome", version: "142" },
      ])?.brand,
    ).toBe("Google Chrome");
  });

  it("falls back to Chromium when it is the only real brand", () => {
    expect(
      pickBrand([
        { brand: "Not;A=Brand", version: "8" },
        { brand: "Chromium", version: "140" },
      ])?.brand,
    ).toBe("Chromium");
  });

  it("returns undefined when nothing but GREASE is present", () => {
    expect(pickBrand([{ brand: "Not;A=Brand", version: "8" }])).toBeUndefined();
  });
});

describe("humanizeDeviceName", () => {
  it("passes through an already-friendly label", () => {
    expect(humanizeDeviceName("Dia 15 · macOS 15")).toBe("Dia 15 · macOS 15");
  });

  it("parses a raw user-agent into browser and OS", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
    expect(humanizeDeviceName(ua)).toBe("Chrome 142 · macOS");
  });

  it("labels an empty value", () => {
    expect(humanizeDeviceName("")).toBe("Unknown device");
  });
});
