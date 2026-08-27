// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ECDSA P-256 (COSE ES256) credential keys.
 *
 * ES256 is the only algorithm this authenticator offers: it is the one every
 * relying party supports, and keeping to a single algorithm keeps the
 * attestation and assertion paths free of per-algorithm branching.
 */

import { buf } from "../crypto/utils.js";
import { fromBase64Url } from "./base64url.js";
import { rawEcdsaToDer } from "./der.js";
import type { P256Coordinates } from "./cose.js";

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" } as const;

export interface P256KeyPair {
  privateKey: Uint8Array; // PKCS#8 DER
  publicKey: Uint8Array; // SPKI DER
  coordinates: P256Coordinates;
}

export async function generateP256KeyPair(): Promise<P256KeyPair> {
  const keyPair = await crypto.subtle.generateKey(ALGORITHM, true, [
    "sign",
    "verify",
  ]);

  const [privateKey, publicKey, jwk] = await Promise.all([
    crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
    crypto.subtle.exportKey("spki", keyPair.publicKey),
    crypto.subtle.exportKey("jwk", keyPair.publicKey),
  ]);

  if (!jwk.x || !jwk.y) {
    throw new Error("p256: generated key exported without coordinates");
  }

  return {
    privateKey: new Uint8Array(privateKey),
    publicKey: new Uint8Array(publicKey),
    coordinates: { x: fromBase64Url(jwk.x), y: fromBase64Url(jwk.y) },
  };
}

export function importP256PrivateKey(pkcs8: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", buf(pkcs8), ALGORITHM, false, [
    "sign",
  ]);
}

/**
 * Sign a message and return the signature in DER form.
 *
 * Web Crypto emits the fixed-width r||s pair; relying parties verify DER, so
 * the conversion belongs here rather than at each call site.
 */
export async function p256Sign(
  key: CryptoKey,
  message: Uint8Array,
): Promise<Uint8Array> {
  const raw = await crypto.subtle.sign(SIGN_PARAMS, key, buf(message));
  return rawEcdsaToDer(new Uint8Array(raw));
}
