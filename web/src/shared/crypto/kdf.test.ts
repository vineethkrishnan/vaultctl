import { describe, it, expect } from "vitest";
import { deriveKeys, type KDFParams } from "./kdf.js";

// Use minimal params for test speed (real defaults: iter=3, mem=64MB, par=4)
const testParams: KDFParams = {
  iterations: 1,
  memoryKB: 19456, // OWASP minimum floor
  parallelism: 1,
};

describe("deriveKeys (full KDF pipeline)", () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  it("produces 32-byte authHash and stretchedKey", async () => {
    const { authHash, stretchedKey } = await deriveKeys(
      "test-password",
      salt,
      testParams,
    );
    expect(authHash.length).toBe(32);
    expect(stretchedKey.length).toBe(32);
  });

  it("authHash and stretchedKey are different", async () => {
    const { authHash, stretchedKey } = await deriveKeys(
      "test-password",
      salt,
      testParams,
    );
    expect(authHash).not.toEqual(stretchedKey);
  });

  it("same inputs produce same outputs (deterministic)", async () => {
    const r1 = await deriveKeys("test-password", salt, testParams);
    const r2 = await deriveKeys("test-password", salt, testParams);
    expect(r1.authHash).toEqual(r2.authHash);
    expect(r1.stretchedKey).toEqual(r2.stretchedKey);
  });

  it("different passwords produce different outputs", async () => {
    const r1 = await deriveKeys("password-a", salt, testParams);
    const r2 = await deriveKeys("password-b", salt, testParams);
    expect(r1.authHash).not.toEqual(r2.authHash);
    expect(r1.stretchedKey).not.toEqual(r2.stretchedKey);
  });

  it("different salts produce different outputs", async () => {
    const salt2 = crypto.getRandomValues(new Uint8Array(16));
    const r1 = await deriveKeys("test-password", salt, testParams);
    const r2 = await deriveKeys("test-password", salt2, testParams);
    expect(r1.authHash).not.toEqual(r2.authHash);
  });

  it("rejects short salt", async () => {
    const shortSalt = new Uint8Array(8);
    await expect(
      deriveKeys("password", shortSalt, testParams),
    ).rejects.toThrow(/salt must be at least 16 bytes/);
  });
});
