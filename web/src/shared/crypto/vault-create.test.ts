// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import {
  generateEd25519KeyPair,
  importEd25519PrivateKey,
  importEd25519PublicKey,
  ed25519Sign,
  ed25519Verify,
} from "./ed25519.js";
import { aesKeyUnwrap } from "./aes-kw.js";
import { parseBlob } from "./blob.js";
import { AlgID } from "./algorithm.js";
import { fromBase64 } from "./utils.js";
import { buildSelfVaultKeyWrap } from "./vault-create.js";

describe("buildSelfVaultKeyWrap", () => {
  it("AES-KW wraps the vault key so the owner can unwrap it with the stretchedKey", async () => {
    const stretchedKey = crypto.getRandomValues(new Uint8Array(32));
    const rawVaultKey = crypto.getRandomValues(new Uint8Array(32));
    const identity = await generateEd25519KeyPair();
    const identityPriv = await importEd25519PrivateKey(identity.privateKey);

    const wrap = await buildSelfVaultKeyWrap({
      rawVaultKey,
      stretchedKey,
      signWrap: (message) => ed25519Sign(identityPriv, message),
    });

    const blob = parseBlob(fromBase64(wrap.encryptedVaultKey));
    expect(blob.alg).toBe(AlgID.AES_256_KW);

    const unwrapped = await aesKeyUnwrap(stretchedKey, blob);
    expect(Array.from(unwrapped)).toEqual(Array.from(rawVaultKey));
  });

  it("signs the serialized wrap blob with the identity key (mirrors registration self-wrap)", async () => {
    const stretchedKey = crypto.getRandomValues(new Uint8Array(32));
    const rawVaultKey = crypto.getRandomValues(new Uint8Array(32));
    const identity = await generateEd25519KeyPair();
    const identityPriv = await importEd25519PrivateKey(identity.privateKey);
    const identityPub = await importEd25519PublicKey(identity.publicKey);

    const wrap = await buildSelfVaultKeyWrap({
      rawVaultKey,
      stretchedKey,
      signWrap: (message) => ed25519Sign(identityPriv, message),
    });

    const encryptedVaultKeyBytes = fromBase64(wrap.encryptedVaultKey);
    const ok = await ed25519Verify(
      identityPub,
      fromBase64(wrap.wrapSignature),
      encryptedVaultKeyBytes,
    );
    expect(ok).toBe(true);
  });

  it("rejects a wrap signature verified against the wrong identity key", async () => {
    const stretchedKey = crypto.getRandomValues(new Uint8Array(32));
    const rawVaultKey = crypto.getRandomValues(new Uint8Array(32));
    const identity = await generateEd25519KeyPair();
    const identityPriv = await importEd25519PrivateKey(identity.privateKey);
    const other = await generateEd25519KeyPair();
    const otherPub = await importEd25519PublicKey(other.publicKey);

    const wrap = await buildSelfVaultKeyWrap({
      rawVaultKey,
      stretchedKey,
      signWrap: (message) => ed25519Sign(identityPriv, message),
    });

    const ok = await ed25519Verify(
      otherPub,
      fromBase64(wrap.wrapSignature),
      fromBase64(wrap.encryptedVaultKey),
    );
    expect(ok).toBe(false);
  });
});
