// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { AlgID, KEY_SIZE_256 } from "./algorithm.js";
import { aesKeyWrap, aesKeyUnwrap } from "./aes-kw.js";
import { serializeBlob, parseBlob } from "./blob.js";

function randomKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_SIZE_256));
}

describe("aesKeyWrap / aesKeyUnwrap", () => {
  it("round-trips a 32-byte vault key", async () => {
    const wrappingKey = randomKey();
    const vaultKey = randomKey();

    const blob = await aesKeyWrap(wrappingKey, vaultKey);
    expect(blob.alg).toBe(AlgID.AES_256_KW);
    expect(blob.nonce.length).toBe(0);
    expect(blob.tag.length).toBe(8);
    expect(blob.ciphertext.length).toBe(32); // same as input

    const unwrapped = await aesKeyUnwrap(wrappingKey, blob);
    expect(unwrapped).toEqual(vaultKey);
  });

  it("round-trips through wire format", async () => {
    const wrappingKey = randomKey();
    const vaultKey = randomKey();

    const blob = await aesKeyWrap(wrappingKey, vaultKey);
    const wire = serializeBlob(blob);

    // Wire: version(1) + alg(1) + tag(8) + ciphertext(32) = 42
    expect(wire.length).toBe(42);
    expect(wire[0]).toBe(0x01); // version
    expect(wire[1]).toBe(0x03); // alg=AES-256-KW

    const parsed = parseBlob(wire);
    const unwrapped = await aesKeyUnwrap(wrappingKey, parsed);
    expect(unwrapped).toEqual(vaultKey);
  });

  it("fails with wrong wrapping key", async () => {
    const key1 = randomKey();
    const key2 = randomKey();
    const vaultKey = randomKey();

    const blob = await aesKeyWrap(key1, vaultKey);
    await expect(aesKeyUnwrap(key2, blob)).rejects.toThrow();
  });

  it("rejects non-multiple-of-8 input", async () => {
    const wrappingKey = randomKey();
    const badInput = new Uint8Array(17); // not multiple of 8
    await expect(aesKeyWrap(wrappingKey, badInput)).rejects.toThrow(
      /multiple of 8/,
    );
  });

  it("rejects empty input", async () => {
    const wrappingKey = randomKey();
    await expect(
      aesKeyWrap(wrappingKey, new Uint8Array(0)),
    ).rejects.toThrow(/non-empty/);
  });

  it("rejects wrong key size", async () => {
    const shortKey = new Uint8Array(16);
    const vaultKey = randomKey();
    await expect(aesKeyWrap(shortKey, vaultKey)).rejects.toThrow(
      /key must be 32 bytes/,
    );
  });

  it("wraps 16-byte keys too", async () => {
    const wrappingKey = randomKey();
    const shortKey = crypto.getRandomValues(new Uint8Array(16));

    const blob = await aesKeyWrap(wrappingKey, shortKey);
    expect(blob.ciphertext.length).toBe(16);

    const unwrapped = await aesKeyUnwrap(wrappingKey, blob);
    expect(unwrapped).toEqual(shortKey);
  });
});
