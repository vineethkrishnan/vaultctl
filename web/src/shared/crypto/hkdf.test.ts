import { describe, it, expect } from "vitest";
import { deriveAuthHash, deriveStretchedKey } from "./hkdf.js";

describe("HKDF derivations", () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));

  it("deriveAuthHash returns 32 bytes", async () => {
    const authHash = await deriveAuthHash(masterKey);
    expect(authHash.length).toBe(32);
  });

  it("deriveStretchedKey returns 32 bytes", async () => {
    const stretchedKey = await deriveStretchedKey(masterKey);
    expect(stretchedKey.length).toBe(32);
  });

  it("authHash and stretchedKey are different from each other", async () => {
    const authHash = await deriveAuthHash(masterKey);
    const stretchedKey = await deriveStretchedKey(masterKey);
    expect(authHash).not.toEqual(stretchedKey);
  });

  it("same input produces same output (deterministic)", async () => {
    const a1 = await deriveAuthHash(masterKey);
    const a2 = await deriveAuthHash(masterKey);
    expect(a1).toEqual(a2);
  });

  it("different masterKeys produce different outputs", async () => {
    const mk2 = crypto.getRandomValues(new Uint8Array(32));
    const h1 = await deriveAuthHash(masterKey);
    const h2 = await deriveAuthHash(mk2);
    expect(h1).not.toEqual(h2);
  });
});
