// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import {
  generatePassword,
  generatePassphrase,
  generateSecret,
  clampGenLength,
  clampGenWords,
  GEN_MAX_LENGTH,
  GEN_WORDS_MAX,
  type GeneratorConfig,
} from "./password-gen";

const base: GeneratorConfig = {
  genLength: 20,
  genLower: true,
  genUpper: true,
  genDigits: true,
  genSymbols: true,
};

describe("generatePassword", () => {
  it("honours the requested length", () => {
    expect(generatePassword({ ...base, genLength: 32 })).toHaveLength(32);
  });

  it("clamps out-of-range lengths", () => {
    expect(clampGenLength(2)).toBe(8);
    expect(clampGenLength(9999)).toBe(GEN_MAX_LENGTH);
  });

  it("only uses the selected character classes", () => {
    const digitsOnly = generatePassword({
      ...base,
      genLength: 64,
      genLower: false,
      genUpper: false,
      genSymbols: false,
    });
    expect(digitsOnly).toMatch(/^[0-9]+$/);
  });

  it("falls back to a safe charset when nothing is selected", () => {
    const pw = generatePassword({
      ...base,
      genLower: false,
      genUpper: false,
      genDigits: false,
      genSymbols: false,
    });
    expect(pw).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe("generatePassphrase", () => {
  it("produces the requested number of words", () => {
    const phrase = generatePassphrase({ ...base, genWords: 5, genWordSep: "-" });
    expect(phrase.split("-")).toHaveLength(5);
  });

  it("clamps the word count", () => {
    expect(clampGenWords(1)).toBe(3);
    expect(clampGenWords(99)).toBe(GEN_WORDS_MAX);
  });

  it("capitalises each word when asked", () => {
    const phrase = generatePassphrase({
      ...base,
      genWords: 4,
      genWordSep: ".",
      genWordCaps: true,
    });
    for (const word of phrase.split(".")) {
      expect(word[0]).toBe(word[0]?.toUpperCase());
    }
  });

  it("appends a trailing number when asked", () => {
    const phrase = generatePassphrase({
      ...base,
      genWords: 3,
      genWordSep: "-",
      genWordDigit: true,
    });
    const parts = phrase.split("-");
    expect(parts).toHaveLength(4);
    expect(parts[3]).toMatch(/^[0-9]+$/);
  });
});

describe("generateSecret", () => {
  it("dispatches to the passphrase generator in passphrase mode", () => {
    const phrase = generateSecret({
      ...base,
      genMode: "passphrase",
      genWords: 4,
      genWordSep: "-",
    });
    expect(phrase.split("-")).toHaveLength(4);
    expect(phrase).toMatch(/^[a-z-]+$/);
  });

  it("dispatches to the password generator by default", () => {
    expect(generateSecret({ ...base, genLength: 16 })).toHaveLength(16);
  });
});
