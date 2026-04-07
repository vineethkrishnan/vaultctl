import { describe, it, expect } from "vitest";
import {
  generateRecoveryKit,
  formatRecoveryKey,
  parseRecoveryKey,
  recoverPrivateKey,
  serializeRecoveryBlob,
} from "./recovery-kit.js";
import { AlgID } from "./algorithm.js";
import { parseBlob } from "./blob.js";

describe("recovery kit", () => {
  const fakePrivateKey = crypto.getRandomValues(new Uint8Array(1218));

  it("generates a 32-byte recovery key and AES-GCM blob", async () => {
    const kit = await generateRecoveryKit(fakePrivateKey);
    expect(kit.recoveryKey.length).toBe(32);
    expect(kit.recoveryWrappedPrivKey.alg).toBe(AlgID.AES_256_GCM);
  });

  it("round-trips: generate → recover", async () => {
    const kit = await generateRecoveryKit(fakePrivateKey);
    const recovered = await recoverPrivateKey(
      kit.recoveryKey,
      kit.recoveryWrappedPrivKey,
    );
    expect(recovered).toEqual(fakePrivateKey);
  });

  it("round-trips through wire format", async () => {
    const kit = await generateRecoveryKit(fakePrivateKey);
    const wire = serializeRecoveryBlob(kit.recoveryWrappedPrivKey);
    const parsed = parseBlob(wire);
    const recovered = await recoverPrivateKey(kit.recoveryKey, parsed);
    expect(recovered).toEqual(fakePrivateKey);
  });

  it("fails with wrong recovery key", async () => {
    const kit = await generateRecoveryKit(fakePrivateKey);
    const wrongKey = crypto.getRandomValues(new Uint8Array(32));
    await expect(
      recoverPrivateKey(wrongKey, kit.recoveryWrappedPrivKey),
    ).rejects.toThrow();
  });
});

describe("formatRecoveryKey / parseRecoveryKey", () => {
  it("formats as hyphen-separated base64 groups", () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const formatted = formatRecoveryKey(key);
    expect(formatted).toContain("-");
    expect(formatted.replace(/-/g, "").length).toBeGreaterThan(0);
  });

  it("round-trips through format/parse", () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const formatted = formatRecoveryKey(key);
    const parsed = parseRecoveryKey(formatted);
    expect(parsed).toEqual(key);
  });

  it("rejects wrong-length key", () => {
    expect(() => parseRecoveryKey("AQID")).toThrow(/invalid key length/);
  });
});
