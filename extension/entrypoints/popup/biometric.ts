// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Touch ID / platform-biometric unlock via WebAuthn + the PRF extension.
 *
 * The vault stays zero-knowledge: a platform authenticator (Touch ID, Windows
 * Hello) holds a credential whose PRF output is a stable 32-byte secret that
 * never leaves the secure element. We HKDF that secret into an AES-256-GCM
 * wrapping key and seal the unlock material ({email, authHash, stretchedKey})
 * under it. The sealed blob lives on disk in storage.local, but it is useless
 * without a successful biometric assertion, so a stolen profile reveals
 * nothing. This is the only place vaultctl writes key-bearing material to disk,
 * and only when the user explicitly enables biometric unlock.
 *
 * Requires Chrome 122+/Firefox 150+ (WebAuthn from an extension page with an
 * RP ID drawn from host_permissions) and the PRF extension (Chrome 116+).
 * Feature-detected; the enroll flow fails closed if PRF is unavailable.
 */

import {
  aesGcmEncryptToBytes,
  aesGcmDecryptFromBytes,
  buf,
  fromBase64,
  toBase64,
  zero,
} from "@shared/crypto";

// The browser's WebAuthn typings predate the PRF extension on some versions,
// so we describe just the slices we touch and cast at the call sites.
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

export interface UnlockSecret {
  email: string;
  authHash: string; // base64
  stretchedKey: string; // base64
}

interface BiometricRecord {
  credentialId: string; // base64
  rpId: string;
  prfSalt: string; // base64 - fixed PRF input for this enrollment
  wrapped: string; // base64 - AES-GCM wire bytes of JSON(UnlockSecret)
  email: string; // shown on the unlock button; not a secret
  createdAt: number;
}

/**
 * True when the runtime exposes WebAuthn and a user-verifying platform
 * authenticator is present. PRF support itself can only be confirmed during
 * enrollment, so callers still handle a failed enroll.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof PublicKeyCredential === "undefined") return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function getBiometricRecord(): Promise<BiometricRecord | null> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as BiometricRecord | undefined) ?? null;
}

export async function isBiometricEnrolled(): Promise<boolean> {
  return (await getBiometricRecord()) !== null;
}

export async function clearBiometric(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY);
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

// Server hostname doubles as the WebAuthn RP ID; the extension's <all_urls>
// host permission authorizes it (Chrome 122+/Firefox 150+).
function rpIdFromServer(serverUrl: string): string {
  return new URL(serverUrl).hostname;
}

async function deriveWrapKey(prfOutput: Uint8Array): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey(
    "raw",
    buf(prfOutput),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: buf(new Uint8Array(0)),
      info: buf(HKDF_INFO),
    },
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
  const prf = (
    assertion.getClientExtensionResults() as { prf?: PrfOutputs }
  ).prf;
  const first = prf?.results?.first;
  if (!first) throw new Error("authenticator did not return a PRF result");
  return new Uint8Array(first);
}

/**
 * Register a platform credential and seal the unlock material under its PRF
 * secret. Throws (and stores nothing) if the authenticator lacks PRF support.
 */
export async function enrollBiometric(
  serverUrl: string,
  secret: UnlockSecret,
): Promise<void> {
  const rpId = rpIdFromServer(serverUrl);
  const created = (await navigator.credentials.create({
    publicKey: {
      rp: { id: rpId, name: "VaultCTL" },
      user: {
        id: buf(randomBytes(16)),
        name: secret.email,
        displayName: secret.email,
      },
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

  const prf = (
    created.getClientExtensionResults() as { prf?: PrfOutputs }
  ).prf;
  if (!prf || prf.enabled === false) {
    throw new Error("this device's biometric does not support PRF");
  }

  const credentialId = new Uint8Array(created.rawId);
  const prfSalt = randomBytes(32);
  // The create() ceremony enables PRF but may not evaluate it; a follow-up
  // get() reliably yields the secret across authenticators.
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
    createdAt: Date.now(),
  };
  await browser.storage.local.set({ [STORAGE_KEY]: record });
}

/**
 * Run the biometric assertion and recover the sealed unlock material. The
 * caller replays it against /auth/login to obtain a fresh session.
 */
export async function unlockWithBiometric(): Promise<UnlockSecret> {
  const record = await getBiometricRecord();
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
    return JSON.parse(decoder.decode(plaintext)) as UnlockSecret;
  } finally {
    zero(plaintext);
  }
}
