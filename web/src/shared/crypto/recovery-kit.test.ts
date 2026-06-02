// SPDX-License-Identifier: AGPL-3.0-or-later

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
  const fakeIdentityKey = crypto.getRandomValues(new Uint8Array(64));

  it("generates a 32-byte recovery key and AES-GCM blobs for both keys", async () => {
    const kit = await generateRecoveryKit(fakePrivateKey, fakeIdentityKey);
    expect(kit.recoveryKey.length).toBe(32);
    expect(kit.recoveryWrappedPrivKey.alg).toBe(AlgID.AES_256_GCM);
    expect(kit.recoveryWrappedIdentityPrivKey.alg).toBe(AlgID.AES_256_GCM);
  });

  it("round-trips: generate → recover (both keys)", async () => {
    const kit = await generateRecoveryKit(fakePrivateKey, fakeIdentityKey);
    expect(
      await recoverPrivateKey(kit.recoveryKey, kit.recoveryWrappedPrivKey),
    ).toEqual(fakePrivateKey);
    expect(
      await recoverPrivateKey(
        kit.recoveryKey,
        kit.recoveryWrappedIdentityPrivKey,
      ),
    ).toEqual(fakeIdentityKey);
  });

  it("round-trips through wire format", async () => {
    const kit = await generateRecoveryKit(fakePrivateKey, fakeIdentityKey);
    const wire = serializeRecoveryBlob(kit.recoveryWrappedPrivKey);
    const parsed = parseBlob(wire);
    const recovered = await recoverPrivateKey(kit.recoveryKey, parsed);
    expect(recovered).toEqual(fakePrivateKey);
  });

  it("fails with wrong recovery key", async () => {
    const kit = await generateRecoveryKit(fakePrivateKey, fakeIdentityKey);
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
