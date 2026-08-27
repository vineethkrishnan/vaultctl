// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { encodeCbor, type CborValue } from "./cbor.js";

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("encodeCbor", () => {
  it("encodes unsigned integers across each head width", () => {
    expect(hex(encodeCbor(0))).toBe("00");
    expect(hex(encodeCbor(23))).toBe("17");
    expect(hex(encodeCbor(24))).toBe("1818");
    expect(hex(encodeCbor(255))).toBe("18ff");
    expect(hex(encodeCbor(256))).toBe("190100");
    expect(hex(encodeCbor(65535))).toBe("19ffff");
    expect(hex(encodeCbor(65536))).toBe("1a00010000");
  });

  it("encodes the negative integers COSE uses as labels", () => {
    expect(hex(encodeCbor(-1))).toBe("20");
    expect(hex(encodeCbor(-7))).toBe("26");
    expect(hex(encodeCbor(-25))).toBe("3818");
  });

  it("encodes byte and text strings", () => {
    expect(hex(encodeCbor(Uint8Array.of(1, 2, 3)))).toBe("43010203");
    expect(hex(encodeCbor("fmt"))).toBe("63666d74");
    expect(hex(encodeCbor(""))).toBe("60");
  });

  it("encodes arrays", () => {
    expect(hex(encodeCbor([1, 2, 3]))).toBe("83010203");
  });

  it("orders map keys shortest-encoding first, then bytewise", () => {
    // Insertion order is deliberately reversed from canonical order.
    const map = new Map<number | string, CborValue>([
      [-3, 3],
      [-1, 1],
      [3, 30],
      [1, 10],
    ]);
    expect(hex(encodeCbor(map))).toBe("a4010a03181e20012203");
  });

  it("orders text keys by length before content", () => {
    const map = new Map<number | string, CborValue>([
      ["authData", 3],
      ["attStmt", 2],
      ["fmt", 1],
    ]);
    expect(hex(encodeCbor(map))).toBe(
      "a3" + "63666d74" + "01" + "6761747453746d74" + "02" + "6861757468446174 61".replace(/ /g, "") + "03",
    );
  });

  it("rejects non-integers and out-of-range values", () => {
    expect(() => encodeCbor(1.5)).toThrow(/not an integer/);
    expect(() => encodeCbor(2 ** 33)).toThrow(/32-bit range/);
  });
});
