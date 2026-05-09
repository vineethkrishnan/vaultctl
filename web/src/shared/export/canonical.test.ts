// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import {
  canonicalize,
  canonicalString,
  CanonicalizationError,
  type JSONValue,
} from "./canonical.js";

describe("canonicalize", () => {
  it("sorts object keys lexicographically", () => {
    expect(canonicalString({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalString([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined fields", () => {
    const obj: JSONValue = { a: 1, b: undefined as unknown as JSONValue, c: 3 };
    expect(canonicalString(obj)).toBe('{"a":1,"c":3}');
  });

  it("handles nested objects deterministically", () => {
    const a: JSONValue = { z: { y: 1, x: 2 }, a: [{ k: 1, j: 2 }] };
    const b: JSONValue = { a: [{ j: 2, k: 1 }], z: { x: 2, y: 1 } };
    expect(canonicalString(a)).toBe(canonicalString(b));
  });

  it("produces identical bytes for identical values regardless of source order", () => {
    const first = canonicalize({ name: "vault", id: "abc" });
    const second = canonicalize({ id: "abc", name: "vault" });
    expect(first).toEqual(second);
  });

  it("escapes strings the same way JSON.stringify does", () => {
    expect(canonicalString('he said "hi"')).toBe('"he said \\"hi\\""');
    expect(canonicalString("line1\nline2")).toBe('"line1\\nline2"');
  });

  it("serializes null, booleans, and finite numbers", () => {
    expect(canonicalString(null)).toBe("null");
    expect(canonicalString(true)).toBe("true");
    expect(canonicalString(false)).toBe("false");
    expect(canonicalString(42)).toBe("42");
    expect(canonicalString(3.14)).toBe("3.14");
    expect(canonicalString(0)).toBe("0");
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalString(Number.NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalString(Number.POSITIVE_INFINITY)).toThrow(
      CanonicalizationError,
    );
    expect(() => canonicalString(Number.NEGATIVE_INFINITY)).toThrow(
      CanonicalizationError,
    );
  });

  it("emits UTF-8 bytes", () => {
    const bytes = canonicalize({ name: "café" });
    // "café" has a multi-byte é — verify we're encoding UTF-8 not UTF-16.
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe('{"name":"café"}');
  });
});
