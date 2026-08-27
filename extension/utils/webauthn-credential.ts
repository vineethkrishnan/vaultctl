// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Building the credential object a relying party receives.
 *
 * Kept out of the relay entrypoint so it can be exercised in a real browser:
 * the shapes here are defined against live PublicKeyCredential prototypes, and
 * nothing about them is observable from a Node test.
 */

import {
  assertionCredentialJSON,
  attestationCredentialJSON,
  ATTACHMENT,
  TRANSPORTS,
} from "./webauthn-request";
import { fromBase64Url } from "@shared/webauthn";

const COSE_ES256 = -7;

export interface BridgeReply {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export function wantsDiscoverable(
  publicKey: PublicKeyCredentialCreationOptions,
): boolean {
  const selection = publicKey.authenticatorSelection;
  if (!selection) return false;
  if (selection.residentKey) return selection.residentKey !== "discouraged";
  return Boolean(selection.requireResidentKey);
}

export function decode(value: unknown): ArrayBuffer {
  const bytes = fromBase64Url(String(value ?? ""));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/**
 * Shape the return value as a real PublicKeyCredential.
 *
 * Relying parties routinely test the result with instanceof or read it off the
 * prototype, so the object is built on the genuine prototypes rather than as a
 * plain literal.
 */
export function buildAttestationCredential(
  reply: BridgeReply,
  publicKey: PublicKeyCredentialCreationOptions,
): PublicKeyCredential {
  const clientDataJSON = decode(reply.clientDataJSON);
  const attestationObject = decode(reply.attestationObject);
  const authenticatorData = decode(reply.authenticatorData);
  const publicKeyBytes = decode(reply.publicKey);
  const algorithm = Number(reply.algorithm ?? COSE_ES256);

  const response = Object.create(
    AuthenticatorAttestationResponse.prototype,
  ) as AuthenticatorAttestationResponse;
  define(response, {
    clientDataJSON,
    attestationObject,
    getAuthenticatorData: () => authenticatorData,
    getPublicKey: () => publicKeyBytes,
    getPublicKeyAlgorithm: () => algorithm,
    getTransports: () => [...TRANSPORTS],
  });

  const credentialId = String(reply.credentialId ?? "");
  const extensions = publicKey.extensions?.credProps
    ? { credProps: { rk: wantsDiscoverable(publicKey) } }
    : {};

  return finishCredential(
    credentialId,
    response,
    extensions,
    attestationCredentialJSON({
      credentialId,
      clientDataJSON: String(reply.clientDataJSON ?? ""),
      attestationObject: String(reply.attestationObject ?? ""),
      authenticatorData: String(reply.authenticatorData ?? ""),
      publicKey: String(reply.publicKey ?? ""),
      publicKeyAlgorithm: algorithm,
      extensions,
    }),
  );
}

export function buildAssertionCredential(reply: BridgeReply): PublicKeyCredential {
  const userHandle = String(reply.userHandle ?? "");
  const response = Object.create(
    AuthenticatorAssertionResponse.prototype,
  ) as AuthenticatorAssertionResponse;
  define(response, {
    clientDataJSON: decode(reply.clientDataJSON),
    authenticatorData: decode(reply.authenticatorData),
    signature: decode(reply.signature),
    userHandle: userHandle ? decode(userHandle) : null,
  });

  const credentialId = String(reply.credentialId ?? "");
  return finishCredential(
    credentialId,
    response,
    {},
    assertionCredentialJSON({
      credentialId,
      clientDataJSON: String(reply.clientDataJSON ?? ""),
      authenticatorData: String(reply.authenticatorData ?? ""),
      signature: String(reply.signature ?? ""),
      userHandle,
      extensions: {},
    }),
  );
}

function finishCredential(
  credentialId: string,
  response: AuthenticatorResponse,
  extensions: AuthenticationExtensionsClientOutputs,
  credentialJSON: Record<string, unknown>,
): PublicKeyCredential {
  const credential = Object.create(
    PublicKeyCredential.prototype,
  ) as PublicKeyCredential;
  define(credential, {
    id: credentialId,
    rawId: decode(credentialId),
    type: "public-key",
    authenticatorAttachment: ATTACHMENT,
    response,
    getClientExtensionResults: () => extensions,
    // Must be defined, not inherited. PublicKeyCredential.prototype.toJSON is
    // a native method that needs internal slots this object does not have, so
    // leaving it inherited makes both credential.toJSON() and
    // JSON.stringify(credential) throw - and stringify is how relying parties
    // usually serialise a credential for their server.
    toJSON: () => structuredClone(credentialJSON),
  });
  return credential;
}

function define(target: object, properties: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(target, key, {
      value,
      enumerable: typeof value !== "function",
      configurable: true,
    });
  }
}
