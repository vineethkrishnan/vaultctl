// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which ceremonies vaultctl takes over, and the JSON shape it hands back.
 *
 * Kept out of the relay entrypoint so both are reachable from tests: the relay
 * itself only runs inside a page, where none of this can be exercised.
 */

import { COSE_ALG_ES256 } from "@shared/webauthn";

// vaultctl is a software authenticator bound to this browser profile, which is
// what "platform" describes. A relying party asking for "cross-platform" wants
// a roaming security key, so those requests are left to the browser.
export const ATTACHMENT = "platform";

// The transports a synced vault passkey is reachable over.
export const TRANSPORTS = ["internal", "hybrid"];

export interface RequestPolicyInput {
  mediation?: string;
  aborted?: boolean;
  pubKeyCredParams?: readonly { alg: number }[];
  authenticatorAttachment?: string;
}

/**
 * Whether this request is one vaultctl can serve at all.
 *
 * Answers only the shape of the request; whether the vault is unlocked and the
 * feature enabled is a separate question the relay asks the background. A false
 * here means the browser handles the ceremony unchanged.
 */
export function isSupportedRequest(input: RequestPolicyInput): boolean {
  // Conditional mediation needs the browser's own autofill surface, so it goes
  // through rather than degrading into a blocking prompt.
  if (input.mediation === "conditional") return false;
  if (input.aborted) return false;

  // An absent list means the relying party accepts the spec defaults, which
  // include ES256; a present list must actually name it.
  const params = input.pubKeyCredParams;
  if (params?.length && !params.some((p) => p.alg === COSE_ALG_ES256)) {
    return false;
  }

  if (input.authenticatorAttachment &&
      input.authenticatorAttachment !== ATTACHMENT) {
    return false;
  }

  return true;
}

export interface AttestationJSONInput {
  credentialId: string;
  clientDataJSON: string;
  attestationObject: string;
  authenticatorData: string;
  publicKey: string;
  publicKeyAlgorithm: number;
  extensions: Record<string, unknown>;
}

export interface AssertionJSONInput {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle: string;
  extensions: Record<string, unknown>;
}

/**
 * The registration JSON a relying party reads.
 *
 * These key names are the wire contract with the server, so they are asserted
 * in tests: a typo here fails a registration with nothing to point at.
 */
export function attestationCredentialJSON(
  input: AttestationJSONInput,
): Record<string, unknown> {
  return {
    id: input.credentialId,
    rawId: input.credentialId,
    type: "public-key",
    authenticatorAttachment: ATTACHMENT,
    clientExtensionResults: input.extensions,
    response: {
      clientDataJSON: input.clientDataJSON,
      attestationObject: input.attestationObject,
      authenticatorData: input.authenticatorData,
      publicKey: input.publicKey,
      publicKeyAlgorithm: input.publicKeyAlgorithm,
      transports: [...TRANSPORTS],
    },
  };
}

export function assertionCredentialJSON(
  input: AssertionJSONInput,
): Record<string, unknown> {
  return {
    id: input.credentialId,
    rawId: input.credentialId,
    type: "public-key",
    authenticatorAttachment: ATTACHMENT,
    clientExtensionResults: input.extensions,
    response: {
      clientDataJSON: input.clientDataJSON,
      authenticatorData: input.authenticatorData,
      signature: input.signature,
      userHandle: input.userHandle || null,
    },
  };
}
