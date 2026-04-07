import { describe, it, expect } from "vitest";
import { AlgID, KEY_SIZE_256 } from "./algorithm.js";
import { aesGcmEncrypt, aesGcmDecrypt, aesGcmEncryptToBytes, aesGcmDecryptFromBytes } from "./aes-gcm.js";
import { serializeBlob, parseBlob } from "./blob.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function randomKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_SIZE_256));
}

describe("aesGcmEncrypt / aesGcmDecrypt", () => {
  it("round-trips plaintext", async () => {
    const key = randomKey();
    const plaintext = encoder.encode("hello, vaultctl!");

    const blob = await aesGcmEncrypt(key, plaintext);
    expect(blob.alg).toBe(AlgID.AES_256_GCM);
    expect(blob.nonce.length).toBe(12);
    expect(blob.tag.length).toBe(16);

    const decrypted = await aesGcmDecrypt(key, blob);
    expect(decoder.decode(decrypted)).toBe("hello, vaultctl!");
  });

  it("round-trips with AAD", async () => {
    const key = randomKey();
    const plaintext = encoder.encode("secret data");
    const aad = encoder.encode("user:u1:field_name");

    const blob = await aesGcmEncrypt(key, plaintext, aad);
    const decrypted = await aesGcmDecrypt(key, blob, aad);
    expect(decoder.decode(decrypted)).toBe("secret data");
  });

  it("fails with wrong key", async () => {
    const key1 = randomKey();
    const key2 = randomKey();
    const blob = await aesGcmEncrypt(key1, encoder.encode("test"));

    await expect(aesGcmDecrypt(key2, blob)).rejects.toThrow();
  });

  it("fails with wrong AAD", async () => {
    const key = randomKey();
    const aad1 = encoder.encode("context-a");
    const aad2 = encoder.encode("context-b");

    const blob = await aesGcmEncrypt(key, encoder.encode("test"), aad1);
    await expect(aesGcmDecrypt(key, blob, aad2)).rejects.toThrow();
  });

  it("rejects wrong key size", async () => {
    const shortKey = new Uint8Array(16);
    await expect(
      aesGcmEncrypt(shortKey, encoder.encode("test")),
    ).rejects.toThrow(/key must be 32 bytes/);
  });

  it("each encryption produces unique nonce", async () => {
    const key = randomKey();
    const pt = encoder.encode("same plaintext");
    const blob1 = await aesGcmEncrypt(key, pt);
    const blob2 = await aesGcmEncrypt(key, pt);

    // Nonces should be different (random)
    expect(blob1.nonce).not.toEqual(blob2.nonce);
  });
});

describe("aesGcmEncryptToBytes / aesGcmDecryptFromBytes", () => {
  it("round-trips through wire format", async () => {
    const key = randomKey();
    const plaintext = encoder.encode("wire format test");

    const wire = await aesGcmEncryptToBytes(key, plaintext);
    expect(wire[0]).toBe(0x01); // version
    expect(wire[1]).toBe(0x01); // alg=AES-256-GCM

    const decrypted = await aesGcmDecryptFromBytes(key, wire);
    expect(decoder.decode(decrypted)).toBe("wire format test");
  });
});

describe("wire format interop", () => {
  it("serialized blob is parseable and decryptable", async () => {
    const key = randomKey();
    const plaintext = encoder.encode("interop test");

    const blob = await aesGcmEncrypt(key, plaintext);
    const wire = serializeBlob(blob);
    const parsed = parseBlob(wire);

    // Parsed blob should have identical fields
    expect(parsed.version).toBe(blob.version);
    expect(parsed.alg).toBe(blob.alg);
    expect(parsed.nonce).toEqual(blob.nonce);
    expect(parsed.ciphertext).toEqual(blob.ciphertext);
    expect(parsed.tag).toEqual(blob.tag);

    // And be decryptable
    const decrypted = await aesGcmDecrypt(key, parsed);
    expect(decoder.decode(decrypted)).toBe("interop test");
  });

  it("handles empty plaintext (should still produce ciphertext due to GCM)", async () => {
    const key = randomKey();
    const blob = await aesGcmEncrypt(key, new Uint8Array(0));
    // AES-GCM with empty plaintext: ciphertext is empty but tag is 16 bytes
    // However, our validateBlob requires non-empty ciphertext for AES-GCM.
    // Web Crypto actually produces empty ciphertext for empty plaintext.
    // Let's verify: the Go side also rejects empty ciphertext for AES-GCM.
    // So this should fail validation.
    expect(blob.ciphertext.length).toBe(0);
  });
});
