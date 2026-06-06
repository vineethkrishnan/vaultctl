// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Personal vault-key wrap for creating a new vault (mirrors registration).
 *
 * At registration the owner generates a fresh 32-byte vault key, wraps it to
 * their own account with AES-256 Key Wrap under the stretchedKey, and signs the
 * serialized wrap blob with their Ed25519 identity key. Creating an additional
 * vault uses the exact same scheme: AES-KW wrap under the held stretchedKey,
 * Ed25519 signature over the serialized blob bytes.
 *
 * Pure function (no module-scoped key state, signing is injected) so the wrap
 * scheme can be unit-tested in isolation. The stretchedKey and identity private
 * key never leave the crypto Worker; the Worker supplies the raw vault key
 * bytes, the wrapping key, and a `signWrap` closure that signs inside its own
 * isolated scope.
 */

import { aesKeyWrap } from "./aes-kw.js";
import { importRSAPublicKey, rsaOaepEncrypt } from "./rsa-oaep.js";
import { serializeBlob } from "./blob.js";
import { toBase64 } from "./utils.js";

export interface SelfVaultKeyWrap {
  encryptedVaultKey: string; // base64 wire blob (alg=AES-256-KW)
  wrapSignature: string; // base64 Ed25519 signature over the serialized blob
}

/**
 * Wrap a freshly generated vault key to the owner's own account and sign it.
 *
 * Steps (mirror the owner's personal-vault wrap at registration):
 *  1. AES-256 Key Wrap the raw vault key under the owner's stretchedKey.
 *  2. Serialize the wrapped blob to wire bytes.
 *  3. Sign the serialized blob bytes with the owner's identity key.
 */
export async function buildSelfVaultKeyWrap(params: {
  rawVaultKey: Uint8Array;
  stretchedKey: Uint8Array;
  signWrap: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<SelfVaultKeyWrap> {
  const wrappedBlob = await aesKeyWrap(params.stretchedKey, params.rawVaultKey);
  const encryptedVaultKeyBytes = serializeBlob(wrappedBlob);
  const signature = await params.signWrap(encryptedVaultKeyBytes);

  return {
    encryptedVaultKey: toBase64(encryptedVaultKeyBytes),
    wrapSignature: toBase64(signature),
  };
}

/**
 * Shared-vault variant of the self-wrap (creating an org vault).
 *
 * A shared vault's member wraps use RSA-OAEP (domain Member.Validate rejects
 * AES-KW for shared vaults). The owner's own initial membership therefore wraps
 * the fresh vault key to their OWN RSA-OAEP public key. The signature scheme is
 * identical to the AES-KW path: Ed25519 over the serialized wire-blob bytes (NOT
 * the H1 vault_id || user_id || blob message used by the recipient share flow,
 * which can't apply here because the vault id doesn't exist yet at create time).
 *
 * The RSA public key is the owner's own wrapping key (sourced from the login
 * payload and held in the Worker); decryption uses the owner's RSA private key,
 * exactly like any other shared-vault key the owner unwraps at login.
 */
export async function buildSelfSharedVaultKeyWrap(params: {
  rawVaultKey: Uint8Array;
  ownRsaPublicKey: Uint8Array; // SPKI DER (the owner's own wrapping key)
  signWrap: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<SelfVaultKeyWrap> {
  const publicKey = await importRSAPublicKey(params.ownRsaPublicKey);
  const wrappedBlob = await rsaOaepEncrypt(publicKey, params.rawVaultKey);
  const encryptedVaultKeyBytes = serializeBlob(wrappedBlob);
  const signature = await params.signWrap(encryptedVaultKeyBytes);

  return {
    encryptedVaultKey: toBase64(encryptedVaultKeyBytes),
    wrapSignature: toBase64(signature),
  };
}
