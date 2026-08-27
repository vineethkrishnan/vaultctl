// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Authenticator data assembly.
 *
 * Layout is rpIdHash(32) || flags(1) || signCount(4) || attestedCredentialData?,
 * where attested credential data is aaguid(16) || credentialIdLength(2) ||
 * credentialId || coseKey. All multi-byte lengths are big-endian.
 */

import { concat, sha256 } from "../crypto/utils.js";

export const FLAG_USER_PRESENT = 0x01;
export const FLAG_USER_VERIFIED = 0x04;
export const FLAG_BACKUP_ELIGIBLE = 0x08;
export const FLAG_BACKED_UP = 0x10;
export const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

export interface AttestedCredential {
  aaguid: Uint8Array;
  credentialId: Uint8Array;
  coseKey: Uint8Array;
}

export interface AuthenticatorDataOptions {
  rpId: string;
  flags: number;
  attestedCredential?: AttestedCredential;
}

export async function buildAuthenticatorData({
  rpId,
  flags,
  attestedCredential,
}: AuthenticatorDataOptions): Promise<Uint8Array> {
  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  const resolvedFlags =
    flags | (attestedCredential ? FLAG_ATTESTED_CREDENTIAL_DATA : 0);

  // A vaultctl passkey is used from every browser signed into the same vault,
  // so a per-device counter would move backwards and read to a relying party
  // as a cloned credential. WebAuthn allows an authenticator that keeps no
  // counter to report zero, which is what every synced provider does.
  const signCount = Uint8Array.of(0, 0, 0, 0);

  const header = concat(rpIdHash, Uint8Array.of(resolvedFlags), signCount);
  if (!attestedCredential) return header;

  const { aaguid, credentialId, coseKey } = attestedCredential;
  const credentialIdLength = Uint8Array.of(
    (credentialId.length >> 8) & 0xff,
    credentialId.length & 0xff,
  );
  return concat(header, aaguid, credentialIdLength, credentialId, coseKey);
}
