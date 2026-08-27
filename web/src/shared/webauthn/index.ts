// SPDX-License-Identifier: AGPL-3.0-or-later

export { toBase64Url, fromBase64Url } from "./base64url.js";

export { rawEcdsaToDer } from "./der.js";

export { encodeCbor, type CborValue, type CborMap } from "./cbor.js";

export { COSE_ALG_ES256, toCoseKey, type P256Coordinates } from "./cose.js";

export { VAULTCTL_AAGUID } from "./aaguid.js";

export {
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  FLAG_BACKUP_ELIGIBLE,
  FLAG_BACKED_UP,
  FLAG_ATTESTED_CREDENTIAL_DATA,
  buildAuthenticatorData,
  type AttestedCredential,
  type AuthenticatorDataOptions,
} from "./authdata.js";

export {
  type P256KeyPair,
  generateP256KeyPair,
  importP256PrivateKey,
  p256Sign,
} from "./p256.js";
