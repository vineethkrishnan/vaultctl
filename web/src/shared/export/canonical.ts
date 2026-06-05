// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Deterministic JSON canonicalization for envelope_mac signing (M9 / M6 hardening).
 *
 * The Ed25519 signature over an export envelope must be reproducible on the
 * importer side, so we need a byte-identical serialization regardless of map
 * iteration order or host runtime. This module implements a small subset of
 * RFC 8785 JCS - enough for the export payload shape, no more:
 *
 *   - Object keys are serialized in lexicographic (UTF-16) order.
 *   - Arrays preserve their source order.
 *   - Strings are JSON-escaped per RFC 8259.
 *   - Numbers MUST be finite integers or fractional decimals - vaultctl
 *     exports never carry NaN/Infinity, so we reject them explicitly.
 *   - `null` is serialized as "null".
 *   - `undefined` keys are dropped (matching JSON.stringify semantics).
 *
 * We do NOT depend on `json-canonicalize` or any other npm package because
 * pulling in a canonicalization library for ~50 lines of logic is not worth
 * the supply-chain surface.
 */

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue =
  | JSONPrimitive
  | JSONValue[]
  | { [key: string]: JSONValue | undefined };

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(`export/canonical: ${message}`);
    this.name = "CanonicalizationError";
  }
}

/**
 * Canonicalize a JSON value to a deterministic UTF-8 byte sequence suitable
 * for hashing or signing. Throws CanonicalizationError on unrepresentable
 * inputs (NaN, Infinity, functions, symbols, bigints).
 */
export function canonicalize(value: JSONValue): Uint8Array {
  return new TextEncoder().encode(canonicalString(value));
}

/** String form of the canonical serialization. Primarily for tests. */
export function canonicalString(value: JSONValue): string {
  return serialize(value);
}

function serialize(value: JSONValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return serializeNumber(value);
  if (typeof value === "string") return serializeString(value);
  if (Array.isArray(value)) return serializeArray(value);
  if (typeof value === "object") return serializeObject(value);
  throw new CanonicalizationError(`unsupported type ${typeof value}`);
}

function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new CanonicalizationError(
      `non-finite numbers cannot be canonicalized: ${n}`,
    );
  }
  // Canonical form: no trailing zeros beyond what JSON.stringify produces.
  // JSON.stringify already emits shortest-round-trip form for floats.
  return JSON.stringify(n);
}

function serializeString(s: string): string {
  // JSON.stringify handles all the required escapes (\\, \", \n, \t, \uXXXX,
  // surrogate pairs) in exactly the way RFC 8785 expects for ASCII-safe JSON.
  return JSON.stringify(s);
}

function serializeArray(arr: JSONValue[]): string {
  const parts: string[] = [];
  for (const item of arr) {
    parts.push(serialize(item));
  }
  return `[${parts.join(",")}]`;
}

function serializeObject(obj: { [key: string]: JSONValue | undefined }): string {
  // Drop `undefined` members to match JSON.stringify semantics, then sort
  // keys lexicographically so both sides of the signing/verifying boundary
  // walk the same byte sequence.
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();

  const parts: string[] = [];
  for (const key of keys) {
    const serializedKey = serializeString(key);
    const serializedValue = serialize(obj[key] as JSONValue);
    parts.push(`${serializedKey}:${serializedValue}`);
  }
  return `{${parts.join(",")}}`;
}
