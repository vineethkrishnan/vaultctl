// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Client-side RFC 6238 TOTP generation. The secret never leaves the browser;
 * codes are derived locally with WebCrypto HMAC over the time counter.
 *
 * Accepts either a bare base32 secret or a full otpauth:// URI and honours the
 * digits / period / algorithm parameters when present, falling back to the
 * RFC defaults (SHA1, 6 digits, 30s).
 */

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface TotpParams {
  secret: Uint8Array;
  digits: number;
  period: number;
  algorithm: TotpAlgorithm;
}

const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD = 30;
const DEFAULT_ALGORITHM: TotpAlgorithm = "SHA1";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function decodeBase32(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  if (cleaned.length === 0) throw new Error("empty base32 secret");

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
}

function normalizeAlgorithm(raw: string | null | undefined): TotpAlgorithm {
  const upper = (raw ?? "").toUpperCase();
  if (upper === "SHA256") return "SHA256";
  if (upper === "SHA512") return "SHA512";
  return DEFAULT_ALGORITHM;
}

const SUBTLE_ALGORITHM: Record<TotpAlgorithm, string> = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
};

/**
 * Parse an otpauth:// URI or a raw base32 secret into the concrete parameters
 * needed to generate codes. Throws if no usable secret can be extracted.
 */
export function parseTotp(input: string): TotpParams {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error("empty totp value");

  if (trimmed.toLowerCase().startsWith("otpauth://")) {
    const url = new URL(trimmed);
    const secretParam = url.searchParams.get("secret");
    if (!secretParam) throw new Error("otpauth URI missing secret");

    const digitsParam = Number(url.searchParams.get("digits"));
    const periodParam = Number(url.searchParams.get("period"));

    return {
      secret: decodeBase32(secretParam),
      digits: Number.isFinite(digitsParam) && digitsParam > 0 ? digitsParam : DEFAULT_DIGITS,
      period: Number.isFinite(periodParam) && periodParam > 0 ? periodParam : DEFAULT_PERIOD,
      algorithm: normalizeAlgorithm(url.searchParams.get("algorithm")),
    };
  }

  return {
    secret: decodeBase32(trimmed),
    digits: DEFAULT_DIGITS,
    period: DEFAULT_PERIOD,
    algorithm: DEFAULT_ALGORITHM,
  };
}

function counterToBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index--) {
    bytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

async function hmac(
  algorithm: TotpAlgorithm,
  key: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: SUBTLE_ALGORITHM[algorithm] },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    message as unknown as BufferSource,
  );
  return new Uint8Array(signature);
}

/** Generate a TOTP code for an explicit unix time (seconds). */
export async function generateTotpAt(
  params: TotpParams,
  unixSeconds: number,
): Promise<string> {
  const counter = Math.floor(unixSeconds / params.period);
  const digest = await hmac(params.algorithm, params.secret, counterToBytes(counter));

  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  const code = binary % 10 ** params.digits;
  return code.toString().padStart(params.digits, "0");
}

/** Generate the current TOTP code using the wall clock. */
export function generateTotp(params: TotpParams): Promise<string> {
  return generateTotpAt(params, Date.now() / 1000);
}

/** Seconds remaining in the current period for a given wall-clock time. */
export function secondsRemaining(period: number, unixSeconds = Date.now() / 1000): number {
  return Math.max(0, Math.ceil(period - (unixSeconds % period)));
}
