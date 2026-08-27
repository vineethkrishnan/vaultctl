// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The authenticator half of the passkey flow.
 *
 * Given a relying party's request and (for an assertion) a stored credential,
 * these build the exact byte structures WebAuthn defines. They are pure apart
 * from key generation and randomness, so the service worker is left with only
 * policy: validating the rpId, asking the user, and persisting the item.
 *
 * Nothing here reads or writes the vault, and the private key never leaves
 * this module in any form the page could see - only a finished attestation
 * object or signature is returned.
 */

import {
  buildAuthenticatorData,
  encodeCbor,
  fromBase64Url,
  generateP256KeyPair,
  importP256PrivateKey,
  p256Sign,
  toBase64Url,
  toCoseKey,
  COSE_ALG_ES256,
  FLAG_BACKED_UP,
  FLAG_BACKUP_ELIGIBLE,
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  VAULTCTL_AAGUID,
  type CborValue,
} from "@shared/webauthn";
import { concat, sha256 } from "@shared/crypto";

// A vaultctl passkey lives in a vault that syncs and is backed up, which is
// exactly what the backup-eligible and backed-up flags describe. User presence
// and verification are set because the user unlocked the vault and confirmed
// this specific ceremony.
const CEREMONY_FLAGS =
  FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_BACKUP_ELIGIBLE | FLAG_BACKED_UP;

const CREDENTIAL_ID_BYTES = 32;

export interface CreationRequest {
  rpId: string;
  rpName: string;
  origin: string;
  challenge: string;
  userHandle: string;
  userName: string;
  userDisplayName: string;
  discoverable: boolean;
}

export interface StoredPasskey {
  rpId: string;
  rpName: string;
  credentialId: string;
  userHandle: string;
  userName: string;
  userDisplayName: string;
  publicKey: string;
  privateKey: string;
  algorithm: number;
  createdAt: string;
  discoverable: boolean;
}

export interface AttestationResult {
  credentialId: string;
  attestationObject: string;
  clientDataJSON: string;
  publicKey: string;
  algorithm: number;
}

export interface AssertionRequest {
  rpId: string;
  origin: string;
  challenge: string;
}

export interface AssertionResult {
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  userHandle: string;
}

export async function createCredential(
  request: CreationRequest,
): Promise<{ passkey: StoredPasskey; attestation: AttestationResult }> {
  const keyPair = await generateP256KeyPair();
  const credentialId = crypto.getRandomValues(
    new Uint8Array(CREDENTIAL_ID_BYTES),
  );

  const authData = await buildAuthenticatorData({
    rpId: request.rpId,
    flags: CEREMONY_FLAGS,
    attestedCredential: {
      aaguid: VAULTCTL_AAGUID,
      credentialId,
      coseKey: toCoseKey(keyPair.coordinates),
    },
  });

  // "none" attestation: vaultctl makes no claim about the hardware a key was
  // generated on, which is the honest answer for a software authenticator and
  // what every synced provider reports.
  const attestationObject = encodeCbor(
    new Map<number | string, CborValue>([
      ["fmt", "none"],
      ["attStmt", new Map<number | string, CborValue>()],
      ["authData", authData],
    ]),
  );

  const clientDataJSON = buildClientData(
    "webauthn.create",
    request.challenge,
    request.origin,
  );

  return {
    passkey: {
      rpId: request.rpId,
      rpName: request.rpName,
      credentialId: toBase64Url(credentialId),
      userHandle: request.userHandle,
      userName: request.userName,
      userDisplayName: request.userDisplayName,
      publicKey: toBase64Url(keyPair.publicKey),
      privateKey: toBase64Url(keyPair.privateKey),
      algorithm: COSE_ALG_ES256,
      createdAt: new Date().toISOString(),
      discoverable: request.discoverable,
    },
    attestation: {
      credentialId: toBase64Url(credentialId),
      attestationObject: toBase64Url(attestationObject),
      clientDataJSON: toBase64Url(clientDataJSON),
      publicKey: toBase64Url(keyPair.publicKey),
      algorithm: COSE_ALG_ES256,
    },
  };
}

export async function signAssertion(
  request: AssertionRequest,
  passkey: StoredPasskey,
): Promise<AssertionResult> {
  const authData = await buildAuthenticatorData({
    rpId: request.rpId,
    flags: CEREMONY_FLAGS,
  });
  const clientDataJSON = buildClientData(
    "webauthn.get",
    request.challenge,
    request.origin,
  );

  const privateKey = await importP256PrivateKey(
    fromBase64Url(passkey.privateKey),
  );
  const signature = await p256Sign(
    privateKey,
    concat(authData, await sha256(clientDataJSON)),
  );

  return {
    credentialId: passkey.credentialId,
    authenticatorData: toBase64Url(authData),
    clientDataJSON: toBase64Url(clientDataJSON),
    signature: toBase64Url(signature),
    userHandle: passkey.userHandle,
  };
}

/**
 * Narrow a relying party's allowCredentials list to the passkeys we hold.
 *
 * An empty or absent list means the relying party will accept any credential
 * it has registered for this rpId, which is the discoverable-credential case.
 */
export function selectCredentials(
  passkeys: StoredPasskey[],
  rpId: string,
  allowCredentials: string[],
): StoredPasskey[] {
  const usable = passkeys.filter(
    (passkey) => passkey.rpId === rpId && passkey.privateKey !== "",
  );
  if (allowCredentials.length === 0) return usable;
  const allowed = new Set(allowCredentials);
  return usable.filter((passkey) => allowed.has(passkey.credentialId));
}

function buildClientData(
  type: "webauthn.create" | "webauthn.get",
  challenge: string,
  origin: string,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ type, challenge, origin, crossOrigin: false }),
  );
}
