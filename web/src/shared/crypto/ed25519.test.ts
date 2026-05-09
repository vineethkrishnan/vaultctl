// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import {
  generateEd25519KeyPair,
  importEd25519PublicKey,
  importEd25519PrivateKey,
  ed25519Sign,
  ed25519Verify,
  buildWrapSignatureMessage,
} from "./ed25519.js";

const encoder = new TextEncoder();

describe("Ed25519", () => {
  it("generates a valid keypair", async () => {
    const kp = await generateEd25519KeyPair();
    expect(kp.publicKey.length).toBe(32); // Raw Ed25519 pubkey = 32 bytes
    expect(kp.privateKey.length).toBeGreaterThan(32); // PKCS#8 DER
  });

  it("sign + verify round-trip", async () => {
    const kp = await generateEd25519KeyPair();
    const privKey = await importEd25519PrivateKey(kp.privateKey);
    const pubKey = await importEd25519PublicKey(kp.publicKey);

    const data = encoder.encode("test message");
    const sig = await ed25519Sign(privKey, data);

    expect(sig.length).toBe(64);
    expect(await ed25519Verify(pubKey, sig, data)).toBe(true);
  });

  it("verification fails with wrong data", async () => {
    const kp = await generateEd25519KeyPair();
    const privKey = await importEd25519PrivateKey(kp.privateKey);
    const pubKey = await importEd25519PublicKey(kp.publicKey);

    const sig = await ed25519Sign(privKey, encoder.encode("original"));
    expect(
      await ed25519Verify(pubKey, sig, encoder.encode("tampered")),
    ).toBe(false);
  });

  it("verification fails with wrong key", async () => {
    const kp1 = await generateEd25519KeyPair();
    const kp2 = await generateEd25519KeyPair();
    const privKey1 = await importEd25519PrivateKey(kp1.privateKey);
    const pubKey2 = await importEd25519PublicKey(kp2.publicKey);

    const sig = await ed25519Sign(privKey1, encoder.encode("test"));
    expect(await ed25519Verify(pubKey2, sig, encoder.encode("test"))).toBe(
      false,
    );
  });

  it("rejects short signatures without throwing", async () => {
    const kp = await generateEd25519KeyPair();
    const pubKey = await importEd25519PublicKey(kp.publicKey);
    const shortSig = new Uint8Array(32);
    expect(
      await ed25519Verify(pubKey, shortSig, encoder.encode("test")),
    ).toBe(false);
  });
});

describe("buildWrapSignatureMessage", () => {
  it("concatenates vault_id + user_id + encrypted_vault_key", () => {
    const msg = buildWrapSignatureMessage(
      "vault-123",
      "user-456",
      new Uint8Array([0xaa, 0xbb]),
    );

    const expected = new Uint8Array([
      ...encoder.encode("vault-123"),
      ...encoder.encode("user-456"),
      0xaa,
      0xbb,
    ]);
    expect(msg).toEqual(expected);
  });
});

describe("C1: identity key signs RSA public key", () => {
  it("full C1 flow: generate identity keypair, sign pubkey, verify", async () => {
    const idKp = await generateEd25519KeyPair();
    const idPriv = await importEd25519PrivateKey(idKp.privateKey);
    const idPub = await importEd25519PublicKey(idKp.publicKey);

    // Simulate RSA public key bytes
    const rsaPubKeyBytes = crypto.getRandomValues(new Uint8Array(294));

    // Sign the RSA pubkey with identity key
    const pubKeySig = await ed25519Sign(idPriv, rsaPubKeyBytes);
    expect(pubKeySig.length).toBe(64);

    // Verify
    expect(await ed25519Verify(idPub, pubKeySig, rsaPubKeyBytes)).toBe(true);
  });
});
