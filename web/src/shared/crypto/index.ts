// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  BLOB_VERSION,
  AlgID,
  isValidAlgId,
  nonceSize,
  tagSize,
  KEY_SIZE_256,
  ED25519_SIGNATURE_SIZE,
  RSA_MODULUS_LENGTH,
} from "./algorithm.js";

export {
  type EncryptedBlob,
  MalformedBlobError,
  validateBlob,
  serializeBlob,
  parseBlob,
} from "./blob.js";

export {
  type KDFParams,
  DEFAULT_KDF_PARAMS,
  deriveArgon2id,
} from "./argon2.js";

export { deriveAuthHash, deriveStretchedKey } from "./hkdf.js";

export {
  aesGcmEncrypt,
  aesGcmDecrypt,
  aesGcmEncryptToBytes,
  aesGcmDecryptFromBytes,
} from "./aes-gcm.js";

export {
  type RSAKeyPair,
  generateRSAKeyPair,
  importRSAPublicKey,
  importRSAPrivateKey,
  rsaOaepEncrypt,
  rsaOaepDecrypt,
} from "./rsa-oaep.js";

export {
  type Ed25519KeyPair,
  generateEd25519KeyPair,
  importEd25519PublicKey,
  importEd25519PrivateKey,
  ed25519Sign,
  ed25519Verify,
  buildWrapSignatureMessage,
} from "./ed25519.js";

export { aesKeyWrap, aesKeyUnwrap } from "./aes-kw.js";

export { deriveKeys } from "./kdf.js";

export { pad, unpad } from "./padding.js";

export {
  generateRecoveryKit,
  formatRecoveryKey,
  parseRecoveryKey,
  recoverPrivateKey,
  recoverPrivateKeyFromBytes,
  serializeRecoveryBlob,
} from "./recovery-kit.js";

export {
  buf,
  zero,
  timingSafeEqual,
  concat,
  toBase64,
  fromBase64,
  sha256,
  sha1,
} from "./utils.js";
