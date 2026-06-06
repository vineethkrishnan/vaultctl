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

export interface GeneratorConfig {
  genLength: number;
  genLower: boolean;
  genUpper: boolean;
  genDigits: boolean;
  genSymbols: boolean;
}

export function clampGenLength(length: number): number {
  return Math.min(GEN_MAX_LENGTH, Math.max(GEN_MIN_LENGTH, length || 20));
}

export function generatePassword(cfg: GeneratorConfig): string {
  let charset = "";
  if (cfg.genLower) charset += GEN_LOWER;
  if (cfg.genUpper) charset += GEN_UPPER;
  if (cfg.genDigits) charset += GEN_DIGITS;
  if (cfg.genSymbols) charset += GEN_SYMBOLS;
  if (!charset) charset = GEN_LOWER + GEN_UPPER + GEN_DIGITS;
  const length = clampGenLength(cfg.genLength);
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (v) => charset[v % charset.length]).join("");
}
