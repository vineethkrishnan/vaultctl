// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { rawEcdsaToDer } from "./der.js";

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

const raw = (r: string, s: string) =>
  Uint8Array.from(
    (r + s).match(/../g)!.map((byte) => parseInt(byte, 16)),
  );

const R_PLAIN = "7f".padEnd(64, "1");
const S_PLAIN = "40".padEnd(64, "2");

describe("rawEcdsaToDer", () => {
  it("wraps two positive integers in a SEQUENCE", () => {
    const der = rawEcdsaToDer(raw(R_PLAIN, S_PLAIN));
    expect(hex(der)).toBe(`3044 0220 ${R_PLAIN} 0220 ${S_PLAIN}`.replace(/ /g, ""));
  });

  it("pads a value whose top bit is set so it is not read as negative", () => {
    const rHigh = "ff".padEnd(64, "0");
    const der = rawEcdsaToDer(raw(rHigh, S_PLAIN));
    // 0x21 length and a 0x00 prefix on r only.
    expect(hex(der)).toBe(
      `3045 0221 00${rHigh} 0220 ${S_PLAIN}`.replace(/ /g, ""),
    );
  });

  it("pads both halves when both top bits are set", () => {
    const high = "80".padEnd(64, "0");
    const der = rawEcdsaToDer(raw(high, high));
    expect(hex(der)).toBe(
      `3046 0221 00${high} 0221 00${high}`.replace(/ /g, ""),
    );
  });

  it("strips leading zero bytes to keep integers minimally encoded", () => {
    const rLeadingZeros = `0000${"11".repeat(30)}`;
    const der = rawEcdsaToDer(raw(rLeadingZeros, S_PLAIN));
    expect(hex(der)).toBe(
      `3042 021e ${"11".repeat(30)} 0220 ${S_PLAIN}`.replace(/ /g, ""),
    );
  });

  it("keeps a single zero byte when the value is entirely zero", () => {
    const der = rawEcdsaToDer(raw("00".repeat(32), S_PLAIN));
    expect(hex(der)).toBe(`3025 0201 00 0220 ${S_PLAIN}`.replace(/ /g, ""));
  });

  it("re-pads after stripping when the first significant byte has its top bit set", () => {
    const rStripThenPad = `00${"ff".repeat(31)}`;
    const der = rawEcdsaToDer(raw(rStripThenPad, S_PLAIN));
    expect(hex(der)).toBe(
      `3044 0220 00${"ff".repeat(31)} 0220 ${S_PLAIN}`.replace(/ /g, ""),
    );
  });

  it("rejects an odd or empty input", () => {
    expect(() => rawEcdsaToDer(new Uint8Array(0))).toThrow(/even length/);
    expect(() => rawEcdsaToDer(new Uint8Array(63))).toThrow(/even length/);
  });
});
