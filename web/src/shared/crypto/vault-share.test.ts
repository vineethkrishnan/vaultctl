// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import {
  generateRSAKeyPair,
  importRSAPrivateKey,
  rsaOaepDecrypt,
} from "./rsa-oaep.js";
import {
  generateEd25519KeyPair,
  importEd25519PrivateKey,
  importEd25519PublicKey,
  ed25519Sign,
  ed25519Verify,
  buildWrapSignatureMessage,
} from "./ed25519.js";
import { parseBlob } from "./blob.js";
import { AlgID } from "./algorithm.js";
import { fromBase64 } from "./utils.js";
import {
  verifyRecipientPublicKey,
  verifyWrapSignature,
  buildSharePayload,
} from "./vault-share.js";

async function makeRecipient() {
  const rsa = await generateRSAKeyPair();
  const identity = await generateEd25519KeyPair();
  const identityPriv = await importEd25519PrivateKey(identity.privateKey);
  // Mirrors registration: pubKeySig = Ed25519(idPriv, rsaPublicKey).
  const publicKeySignature = await ed25519Sign(identityPriv, rsa.publicKey);
  return { rsa, identity, publicKeySignature };
}

describe("verifyRecipientPublicKey", () => {
  it("accepts a public key signed by its identity key", async () => {
    const r = await makeRecipient();
    const ok = await verifyRecipientPublicKey({
      rsaPublicKey: r.rsa.publicKey,
      identityPublicKey: r.identity.publicKey,
      publicKeySignature: r.publicKeySignature,
    });
    expect(ok).toBe(true);
  });

  it("rejects a substituted (unsigned) public key (MITM)", async () => {
    const r = await makeRecipient();
    const attacker = await generateRSAKeyPair();
    // Attacker swaps in their own RSA key but cannot forge the identity signature.
    const ok = await verifyRecipientPublicKey({
      rsaPublicKey: attacker.publicKey,
      identityPublicKey: r.identity.publicKey,
      publicKeySignature: r.publicKeySignature,
    });
    expect(ok).toBe(false);
  });

  it("rejects a signature from a different identity key", async () => {
    const r = await makeRecipient();
    const other = await generateEd25519KeyPair();
    const ok = await verifyRecipientPublicKey({
      rsaPublicKey: r.rsa.publicKey,
      identityPublicKey: other.publicKey,
      publicKeySignature: r.publicKeySignature,
    });
    expect(ok).toBe(false);
  });
});

describe("buildSharePayload", () => {
  const vaultId = "vault-123";
  const recipientUserId = "user-abc";

  it("wraps the vault key so the recipient can RSA-OAEP decrypt it", async () => {
    const recipient = await makeRecipient();
    const senderIdentity = await generateEd25519KeyPair();
    const senderPriv = await importEd25519PrivateKey(senderIdentity.privateKey);
    const rawVaultKey = crypto.getRandomValues(new Uint8Array(32));

    const payload = await buildSharePayload({
      vaultId,
      recipientUserId,
      rawVaultKey,
      recipientRsaPublicKey: recipient.rsa.publicKey,
      signWrap: (message) => ed25519Sign(senderPriv, message),
    });

    const blob = parseBlob(fromBase64(payload.encryptedVaultKey));
    expect(blob.alg).toBe(AlgID.RSA_OAEP_SHA256);

    const recipientPriv = await importRSAPrivateKey(recipient.rsa.privateKey);
    const unwrapped = await rsaOaepDecrypt(recipientPriv, blob);
    expect(Array.from(unwrapped)).toEqual(Array.from(rawVaultKey));
  });

  it("signs the H1 message vault_id || recipient_user_id || encrypted_vault_key", async () => {
    const recipient = await makeRecipient();
    const senderIdentity = await generateEd25519KeyPair();
    const senderPriv = await importEd25519PrivateKey(senderIdentity.privateKey);
    const senderPub = await importEd25519PublicKey(senderIdentity.publicKey);
    const rawVaultKey = crypto.getRandomValues(new Uint8Array(32));

    const payload = await buildSharePayload({
      vaultId,
      recipientUserId,
      rawVaultKey,
      recipientRsaPublicKey: recipient.rsa.publicKey,
      signWrap: (message) => ed25519Sign(senderPriv, message),
    });

    const encryptedVaultKeyBytes = fromBase64(payload.encryptedVaultKey);
    const expectedMessage = buildWrapSignatureMessage(
      vaultId,
      recipientUserId,
      encryptedVaultKeyBytes,
    );
    const ok = await ed25519Verify(
      senderPub,
      fromBase64(payload.wrapSignature),
      expectedMessage,
    );
    expect(ok).toBe(true);
  });
});

describe("verifyWrapSignature", () => {
  const vaultId = "vault-123";
  const recipientUserId = "user-abc";

  async function makeWrap() {
    const recipient = await makeRecipient();
    const senderIdentity = await generateEd25519KeyPair();
    const senderPriv = await importEd25519PrivateKey(senderIdentity.privateKey);
    const payload = await buildSharePayload({
      vaultId,
      recipientUserId,
      rawVaultKey: crypto.getRandomValues(new Uint8Array(32)),
      recipientRsaPublicKey: recipient.rsa.publicKey,
      signWrap: (message) => ed25519Sign(senderPriv, message),
    });
    return {
      senderIdentityPublicKey: senderIdentity.publicKey,
      encryptedVaultKey: fromBase64(payload.encryptedVaultKey),
      wrapSignature: fromBase64(payload.wrapSignature),
    };
  }

  it("accepts a wrap the named sender actually signed", async () => {
    const wrap = await makeWrap();
    const ok = await verifyWrapSignature({
      vaultId,
      recipientUserId,
      encryptedVaultKey: wrap.encryptedVaultKey,
      wrapSignature: wrap.wrapSignature,
      senderIdentityPublicKey: wrap.senderIdentityPublicKey,
    });
    expect(ok).toBe(true);
  });

  it("rejects a vault key the server swapped underneath the signature", async () => {
    const wrap = await makeWrap();
    const tampered = Uint8Array.from(wrap.encryptedVaultKey);
    const lastByte = tampered.length - 1;
    tampered[lastByte] = (tampered[lastByte] ?? 0) ^ 0xff;
    const ok = await verifyWrapSignature({
      vaultId,
      recipientUserId,
      encryptedVaultKey: tampered,
      wrapSignature: wrap.wrapSignature,
      senderIdentityPublicKey: wrap.senderIdentityPublicKey,
    });
    expect(ok).toBe(false);
  });

  it("rejects a wrap signed by someone other than the named sender", async () => {
    const wrap = await makeWrap();
    const impostor = await generateEd25519KeyPair();
    const ok = await verifyWrapSignature({
      vaultId,
      recipientUserId,
      encryptedVaultKey: wrap.encryptedVaultKey,
      wrapSignature: wrap.wrapSignature,
      senderIdentityPublicKey: impostor.publicKey,
    });
    expect(ok).toBe(false);
  });

  it("rejects a wrap replayed onto a different vault", async () => {
    const wrap = await makeWrap();
    const ok = await verifyWrapSignature({
      vaultId: "vault-999",
      recipientUserId,
      encryptedVaultKey: wrap.encryptedVaultKey,
      wrapSignature: wrap.wrapSignature,
      senderIdentityPublicKey: wrap.senderIdentityPublicKey,
    });
    expect(ok).toBe(false);
  });

  it("rejects a wrap replayed onto a different recipient", async () => {
    const wrap = await makeWrap();
    const ok = await verifyWrapSignature({
      vaultId,
      recipientUserId: "user-zzz",
      encryptedVaultKey: wrap.encryptedVaultKey,
      wrapSignature: wrap.wrapSignature,
      senderIdentityPublicKey: wrap.senderIdentityPublicKey,
    });
    expect(ok).toBe(false);
  });

  it("rejects rather than throws when the sender identity key is missing", async () => {
    const wrap = await makeWrap();
    const ok = await verifyWrapSignature({
      vaultId,
      recipientUserId,
      encryptedVaultKey: wrap.encryptedVaultKey,
      wrapSignature: wrap.wrapSignature,
      senderIdentityPublicKey: new Uint8Array(0),
    });
    expect(ok).toBe(false);
  });

  it("rejects rather than throws on a malformed sender identity key", async () => {
    const wrap = await makeWrap();
    const ok = await verifyWrapSignature({
      vaultId,
      recipientUserId,
      encryptedVaultKey: wrap.encryptedVaultKey,
      wrapSignature: wrap.wrapSignature,
      senderIdentityPublicKey: new Uint8Array([1, 2, 3]),
    });
    expect(ok).toBe(false);
  });
});
