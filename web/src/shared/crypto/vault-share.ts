// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Vault-sharing key-wrap logic (M8 / H1).
 *
 * When an admin shares a vault with a recipient, the raw vault key is wrapped
 * to the recipient's RSA-OAEP public key and the wrap is signed by the sender's
 * Ed25519 identity key over (vault_id || recipient_user_id || encrypted_vault_key).
 *
 * Mirrors the owner's own wrap at registration (rsaOaepEncrypt + Ed25519 sign)
 * and the H1 message format produced by buildWrapSignatureMessage.
 *
 * These are pure functions (no module-scoped key state, signing is injected) so
 * the wrap/verify scheme can be unit-tested in isolation. The raw vault key and
 * the sender's identity private key never leave the crypto Worker; the Worker
 * supplies the raw key bytes and a `signWrap` closure that signs inside its own
 * isolated scope.
 */

import { importEd25519PublicKey, ed25519Verify } from "./ed25519.js";
import { importRSAPublicKey, rsaOaepEncrypt } from "./rsa-oaep.js";
import { serializeBlob } from "./blob.js";
import { buildWrapSignatureMessage } from "./ed25519.js";
import { toBase64 } from "./utils.js";

/**
 * Verify that a recipient's RSA-OAEP wrapping public key is authentic: the
 * recipient's Ed25519 identity key must have signed the RSA public key bytes
 * (C1). This is the same binding the owner produces at registration
 * (pubKeySig = Ed25519(idPriv, rsaPublicKey)).
 *
 * Skipping this check would let a malicious server substitute its own RSA key
 * and read the shared vault (MITM). Returns true only when the signature is
 * valid for the given identity key.
 */
export async function verifyRecipientPublicKey(params: {
  rsaPublicKey: Uint8Array; // SPKI DER (the wrapping key)
  identityPublicKey: Uint8Array; // raw 32-byte Ed25519 (the pinned identity)
  publicKeySignature: Uint8Array; // Ed25519(idPriv, rsaPublicKey)
}): Promise<boolean> {
  const identityKey = await importEd25519PublicKey(params.identityPublicKey);
  return ed25519Verify(
    identityKey,
    params.publicKeySignature,
    params.rsaPublicKey,
  );
}

export interface SharePayload {
  encryptedVaultKey: string; // base64 wire blob (alg=RSA-OAEP-SHA256)
  wrapSignature: string; // base64 Ed25519 signature
}

/**
 * Wrap a raw vault key to a recipient and sign the wrap.
 *
 * Steps (mirrors the owner's own vault-key wrap + H1 signature):
 *  1. RSA-OAEP-SHA256 encrypt the raw vault key to the recipient's public key.
 *  2. Serialize the blob to wire bytes.
 *  3. Build the H1 message: vault_id || recipient_user_id || encrypted_vault_key.
 *  4. Sign it with the sender's identity key (injected `signWrap`).
 *
 * The caller MUST have already verified the recipient's public key with
 * verifyRecipientPublicKey before calling this.
 */
export async function buildSharePayload(params: {
  vaultId: string;
  recipientUserId: string;
  rawVaultKey: Uint8Array;
  recipientRsaPublicKey: Uint8Array; // SPKI DER
  signWrap: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<SharePayload> {
  const recipientKey = await importRSAPublicKey(params.recipientRsaPublicKey);
  const wrappedBlob = await rsaOaepEncrypt(recipientKey, params.rawVaultKey);
  const encryptedVaultKeyBytes = serializeBlob(wrappedBlob);

  const message = buildWrapSignatureMessage(
    params.vaultId,
    params.recipientUserId,
    encryptedVaultKeyBytes,
  );
  const signature = await params.signWrap(message);

  return {
    encryptedVaultKey: toBase64(encryptedVaultKeyBytes),
    wrapSignature: toBase64(signature),
  };
}
