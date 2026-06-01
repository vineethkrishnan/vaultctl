// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Touch ID / platform-biometric unlock for the web app via WebAuthn + the PRF
 * extension. Mirrors the browser extension's approach.
 *
 * Zero-knowledge is preserved: a platform authenticator (Touch ID, Windows
 * Hello) holds a credential whose PRF output is a stable secret that never
 * leaves the secure element. We HKDF that into an AES-256-GCM key and seal the
 * unlock material under it. The sealed blob lives in localStorage; it is
 * useless without a successful biometric assertion, so it can only be opened on
 * this device by this user. This is the only place the web app persists
 * key-bearing material, and only when the user opts in.
 *
 * Requires the PRF extension (Chrome 116+, recent Safari/Firefox) and a
 * platform authenticator; feature-detected, and enroll fails closed.
 */

import {
  aesGcmEncryptToBytes,
  aesGcmDecryptFromBytes,
  buf,
  fromBase64,
  toBase64,
  zero,
} from "@/shared/crypto";

interface PrfInputs {
  eval?: { first: BufferSource };
}
interface PrfOutputs {
  enabled?: boolean;
  results?: { first?: ArrayBuffer };
}

const STORAGE_KEY = "vaultctl_biometric";
const HKDF_INFO = new TextEncoder().encode("vaultctl-biometric-wrap-v1");
const decoder = new TextDecoder();

export interface BiometricKDF {
  salt: string;
  iterations: number;
  memoryKB: number;
  parallelism: number;
}

export interface UnlockSecret {
  email: string;
  authHash: string; // base64
  stretchedKey: string; // base64
}

interface BiometricRecord {
  credentialId: string; // base64
  rpId: string;
  prfSalt: string; // base64
  wrapped: string; // base64 AES-GCM wire bytes of JSON(UnlockSecret)
  email: string; // shown on the unlock button; not a secret
  kdf: BiometricKDF; // public KDF params, so unlock can restore step-up state
  createdAt: number;
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof PublicKeyCredential === "undefined") return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function getBiometricRecord(): BiometricRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BiometricRecord) : null;
  } catch {
    return null;
  }
}

export function isBiometricEnrolled(): boolean {
  return getBiometricRecord() !== null;
}

export function clearBiometric(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function deriveWrapKey(prfOutput: Uint8Array): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", buf(prfOutput), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: buf(new Uint8Array(0)), info: buf(HKDF_INFO) },
    base,
    256,
  );
  return new Uint8Array(bits);
}

async function evaluatePrf(
  rpId: string,
  credentialId: Uint8Array,
  prfSalt: Uint8Array,
): Promise<Uint8Array> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      rpId,
      challenge: buf(randomBytes(32)),
      allowCredentials: [{ id: buf(credentialId), type: "public-key" }],
      userVerification: "required",
      timeout: 60_000,
      extensions: {
        prf: { eval: { first: buf(prfSalt) } } as PrfInputs,
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("biometric prompt was dismissed");
  const prf = (assertion.getClientExtensionResults() as { prf?: PrfOutputs }).prf;
  const first = prf?.results?.first;
  if (!first) throw new Error("authenticator did not return a PRF result");
  return new Uint8Array(first);
}

/**
 * Register a platform credential and seal the unlock material under its PRF
 * secret. Throws (storing nothing) if the authenticator lacks PRF support.
 */
export async function enrollBiometric(
  secret: UnlockSecret,
  kdf: BiometricKDF,
): Promise<void> {
  const rpId = window.location.hostname;
  const created = (await navigator.credentials.create({
    publicKey: {
      rp: { id: rpId, name: "VaultCTL" },
      user: { id: buf(randomBytes(16)), name: secret.email, displayName: secret.email },
      challenge: buf(randomBytes(32)),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "discouraged",
      },
      timeout: 60_000,
      extensions: { prf: {} as PrfInputs } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!created) throw new Error("biometric enrollment was dismissed");

  const prf = (created.getClientExtensionResults() as { prf?: PrfOutputs }).prf;
  if (!prf || prf.enabled === false) {
    throw new Error("this device's biometric does not support PRF");
  }

  const credentialId = new Uint8Array(created.rawId);
  const prfSalt = randomBytes(32);
  const prfOutput = await evaluatePrf(rpId, credentialId, prfSalt);
  const wrapKey = await deriveWrapKey(prfOutput);

  const plaintext = new TextEncoder().encode(JSON.stringify(secret));
  const wrapped = await aesGcmEncryptToBytes(wrapKey, plaintext);
  zero(wrapKey);
  zero(prfOutput);

  const record: BiometricRecord = {
    credentialId: toBase64(credentialId),
    rpId,
    prfSalt: toBase64(prfSalt),
    wrapped: toBase64(wrapped),
    email: secret.email,
    kdf,
    createdAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

/** Run the biometric assertion and recover the sealed unlock material. */
export async function unlockWithBiometric(): Promise<{
  secret: UnlockSecret;
  kdf: BiometricKDF;
}> {
  const record = getBiometricRecord();
  if (!record) throw new Error("no biometric enrollment on this device");
  const prfOutput = await evaluatePrf(
    record.rpId,
    fromBase64(record.credentialId),
    fromBase64(record.prfSalt),
  );
  const wrapKey = await deriveWrapKey(prfOutput);
  const plaintext = await aesGcmDecryptFromBytes(wrapKey, fromBase64(record.wrapped));
  zero(wrapKey);
  zero(prfOutput);
  try {
    return { secret: JSON.parse(decoder.decode(plaintext)) as UnlockSecret, kdf: record.kdf };
  } finally {
    zero(plaintext);
  }
}
