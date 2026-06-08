// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Strong-password generation shared by the background worker and the popup.
 *
 * Both call sites must agree on the charset, the length clamp, and the
 * fallback-when-no-class-selected behaviour, so the logic lives here once.
 */

export const GEN_LOWER = "abcdefghijkmnopqrstuvwxyz";
export const GEN_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const GEN_DIGITS = "23456789";
export const GEN_SYMBOLS = "!@#$%^&*()-_=+[]{}";

export const GEN_MIN_LENGTH = 8;
export const GEN_MAX_LENGTH = 128;

export const GEN_WORDS_MIN = 3;
export const GEN_WORDS_MAX = 10;

export type GenMode = "password" | "passphrase";

export interface GeneratorConfig {
  genMode?: GenMode;
  genLength: number;
  genLower: boolean;
  genUpper: boolean;
  genDigits: boolean;
  genSymbols: boolean;
  // Passphrase ("memorable") mode: pronounceable words joined by a separator.
  genWords?: number;
  genWordSep?: string;
  genWordCaps?: boolean;
  genWordDigit?: boolean;
}

export function clampGenLength(length: number): number {
  return Math.min(GEN_MAX_LENGTH, Math.max(GEN_MIN_LENGTH, length || 20));
}

export function clampGenWords(words: number): number {
  return Math.min(GEN_WORDS_MAX, Math.max(GEN_WORDS_MIN, words || 4));
}

// A uniform random integer in [0, maxExclusive) without modulo bias, so every
// charset symbol / syllable is equally likely (the naive `v % n` skews toward
// the low end when n does not divide 2^32 evenly).
function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) return 0;
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0]!;
  } while (value >= limit);
  return value % maxExclusive;
}

export function generatePassword(cfg: GeneratorConfig): string {
  let charset = "";
  if (cfg.genLower) charset += GEN_LOWER;
  if (cfg.genUpper) charset += GEN_UPPER;
  if (cfg.genDigits) charset += GEN_DIGITS;
  if (cfg.genSymbols) charset += GEN_SYMBOLS;
  if (!charset) charset = GEN_LOWER + GEN_UPPER + GEN_DIGITS;
  const length = clampGenLength(cfg.genLength);
  let out = "";
  for (let i = 0; i < length; i++) out += charset[randomInt(charset.length)];
  return out;
}

// Pronounceable "memorable" words built from consonant+vowel syllables. Avoids
// shipping a multi-thousand-word dictionary while still giving solid entropy:
// each syllable is one of 17x5 = 85 combinations (~6.4 bits), so a 3-syllable
// word carries ~19 bits and the default 4 words ~77 bits, before capitalisation
// or the optional trailing number.
const GEN_WORD_CONSONANTS = "bcdfghjklmnprstvz";
const GEN_WORD_VOWELS = "aeiou";
const GEN_WORD_SYLLABLES = 3;

function makeWord(): string {
  let word = "";
  for (let i = 0; i < GEN_WORD_SYLLABLES; i++) {
    word += GEN_WORD_CONSONANTS[randomInt(GEN_WORD_CONSONANTS.length)];
    word += GEN_WORD_VOWELS[randomInt(GEN_WORD_VOWELS.length)];
  }
  return word;
}

export function generatePassphrase(cfg: GeneratorConfig): string {
  const count = clampGenWords(cfg.genWords ?? 4);
  const separator = cfg.genWordSep ?? "-";
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    let word = makeWord();
    if (cfg.genWordCaps) word = word[0]!.toUpperCase() + word.slice(1);
    words.push(word);
  }
  let out = words.join(separator);
  if (cfg.genWordDigit) out += separator + String(randomInt(90) + 10);
  return out;
}

export function generateSecret(cfg: GeneratorConfig): string {
  return cfg.genMode === "passphrase"
    ? generatePassphrase(cfg)
    : generatePassword(cfg);
}
