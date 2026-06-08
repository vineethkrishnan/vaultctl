// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { isWeakPassword, reusedPasswords } from "./password-health";

describe("isWeakPassword", () => {
  it("flags short passwords", () => {
    expect(isWeakPassword("ab12")).toBe(true);
    expect(isWeakPassword("Abcd1!")).toBe(true);
  });

  it("flags medium-length low-variety passwords", () => {
    expect(isWeakPassword("password")).toBe(true); // 8 chars, one class
    expect(isWeakPassword("abcdefghij")).toBe(true); // 10 chars, one class
  });

  it("accepts long or varied passwords", () => {
    expect(isWeakPassword("Abcd1234!xyz")).toBe(false); // 12 chars
    expect(isWeakPassword("Abc1!xyz")).toBe(false); // 8 chars, 4 classes
  });

  it("ignores empty strings", () => {
    expect(isWeakPassword("")).toBe(false);
  });
});

describe("reusedPasswords", () => {
  it("returns passwords used two or more times", () => {
    const reused = reusedPasswords(["a", "b", "a", "c", "b"]);
    expect([...reused].sort()).toEqual(["a", "b"]);
  });

  it("ignores empty passwords and unique ones", () => {
    const reused = reusedPasswords(["", "", "x", "y"]);
    expect(reused.size).toBe(0);
  });
});
