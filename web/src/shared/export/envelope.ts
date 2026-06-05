// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Export envelope - Ed25519-signed wrapper over a vaultctl export payload
 * (architecture.md §M9, PRD hardening item M6).
 *
 * Shape on disk:
 *   {
 *     "version":      1,
 *     "created_at":   "2026-04-11T14:03:00Z",
 *     "user_id":      "uuid",
 *     "items":        [ {id, encrypted_data, encrypted_name, item_type, folder_id}, ... ],
 *     "envelope_mac": "<base64-ed25519-sig-over-canonical-body>"
 *   }
 *
 * The signature covers the canonicalized body object
 *     { version, created_at, user_id, items }
 * - the same bytes both sides will hash and compare.
 *
 * Signing happens ONLY in the client's Web Worker scope, because the server
 * is zero-knowledge and has no access to the user's identity private key.
 * Verification happens on import, BEFORE any item is decrypted or posted.
 * Any failure - signature mismatch, truncated JSON, wrong user_id, bad
 * version - MUST fail-closed and reject the entire import batch.
 */

import {
  ed25519Sign,
  ed25519Verify,
  importEd25519PrivateKey,
  importEd25519PublicKey,
} from "../crypto/ed25519.js";
import { fromBase64, sha256, toBase64 } from "../crypto/utils.js";
import { canonicalize, type JSONValue } from "./canonical.js";

/** Current envelope format version. Bump on ANY body-shape change. */
export const EXPORT_ENVELOPE_VERSION = 1;

/**
 * A single item in an export envelope. Matches the server's ExportItem DTO
 * one-for-one so the round-trip is just (decode → re-encode) with no shape
 * translation.
 */
export interface ExportEnvelopeItem {
  id: string;
  vaultId: string;
  folderId?: string;
  itemType: string;
  /** Base64 of the wire-format encrypted blob. */
  encryptedData: string;
  /** Base64 of the wire-format encrypted name blob. */
  encryptedName: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single vault header in an export envelope. Folders and vault metadata
 * travel alongside items but are optional for verification purposes.
 */
export interface ExportEnvelopeVault {
  id: string;
  name: string;
  type: string;
  createdAt: string;
}

export interface ExportEnvelopeFolder {
  id: string;
  vaultId: string;
  encryptedName: string;
  createdAt: string;
}

/**
 * The unsigned body of an envelope. Exactly this object is canonicalized,
 * SHA-256'd, and signed by the user's identity private key.
 */
export interface ExportEnvelopeBody {
  version: number;
  createdAt: string;
  userId: string;
  vaults: ExportEnvelopeVault[];
  items: ExportEnvelopeItem[];
  folders: ExportEnvelopeFolder[];
}

/** Full envelope as written to disk or the network. */
export interface ExportEnvelope extends ExportEnvelopeBody {
  /** Base64 Ed25519 signature over canonicalize(body). */
  envelopeMac: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(`export/envelope: ${message}`);
    this.name = "EnvelopeError";
  }
}

export class EnvelopeVersionError extends EnvelopeError {
  constructor(got: number) {
    super(`unsupported envelope version ${got}, expected ${EXPORT_ENVELOPE_VERSION}`);
    this.name = "EnvelopeVersionError";
  }
}

export class EnvelopeSignatureError extends EnvelopeError {
  constructor(reason: string) {
    super(`signature verification failed: ${reason}`);
    this.name = "EnvelopeSignatureError";
  }
}

export class EnvelopeUserMismatchError extends EnvelopeError {
  constructor(expected: string, got: string) {
    super(`envelope user_id ${got} does not match expected ${expected}`);
    this.name = "EnvelopeUserMismatchError";
  }
}

// ---------------------------------------------------------------------------
// Sign / serialize
// ---------------------------------------------------------------------------

/** A function that signs a message with the user's identity private key. */
export type IdentitySigner = (message: Uint8Array) => Promise<Uint8Array>;

/**
 * Build a signed export envelope from raw body data + a signer function.
 * This is the production path - the web app passes a signer backed by the
 * Web Worker (the worker holds the identity private key; only the
 * signature bytes cross the thread boundary).
 */
export async function buildSignedEnvelopeWithSigner(
  body: Omit<ExportEnvelopeBody, "version">,
  sign: IdentitySigner,
): Promise<Uint8Array> {
  const fullBody: ExportEnvelopeBody = {
    version: EXPORT_ENVELOPE_VERSION,
    ...body,
  };

  const canonical = canonicalBody(fullBody);
  const digest = await sha256(canonical);
  const signature = await sign(digest);

  const envelope: ExportEnvelope = {
    ...fullBody,
    envelopeMac: toBase64(signature),
  };

  // The on-wire envelope does NOT need to be canonical - only the body
  // being signed must be. We emit a pretty-printed form so human audit is
  // cheap, and re-parse sorts into the canonical form on import anyway.
  return new TextEncoder().encode(JSON.stringify(envelope, null, 2) + "\n");
}

/**
 * Build a signed export envelope from raw body data + the user's Ed25519
 * identity private key bytes (PKCS#8 DER). Convenience for tests and any
 * call site that already holds the raw key bytes directly. Production code
 * should prefer buildSignedEnvelopeWithSigner so the private key never has
 * to leave the Worker scope.
 */
export async function buildSignedEnvelope(
  body: Omit<ExportEnvelopeBody, "version">,
  identityPrivKeyPKCS8: Uint8Array,
): Promise<Uint8Array> {
  const privateKey = await importEd25519PrivateKey(identityPrivKeyPKCS8);
  return buildSignedEnvelopeWithSigner(body, (digest) =>
    ed25519Sign(privateKey, digest),
  );
}

/**
 * Parse + verify an envelope in one pass. Returns the body on success,
 * throws on ANY failure. Callers must pass the expected user's raw 32-byte
 * Ed25519 public key AND the expected user ID - the latter guards against
 * cross-account replay where a valid envelope from user A is imported by
 * user B.
 */
export async function verifyEnvelope(
  raw: Uint8Array | string,
  expectedUserId: string,
  identityPublicKeyRaw: Uint8Array,
): Promise<ExportEnvelopeBody> {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);

  let parsed: ExportEnvelope;
  try {
    parsed = JSON.parse(text) as ExportEnvelope;
  } catch (err) {
    throw new EnvelopeError(
      `malformed JSON: ${(err as Error).message ?? "unknown"}`,
    );
  }

  assertEnvelopeShape(parsed);

  if (parsed.version !== EXPORT_ENVELOPE_VERSION) {
    throw new EnvelopeVersionError(parsed.version);
  }
  if (parsed.userId !== expectedUserId) {
    throw new EnvelopeUserMismatchError(expectedUserId, parsed.userId);
  }

  const body: ExportEnvelopeBody = {
    version: parsed.version,
    createdAt: parsed.createdAt,
    userId: parsed.userId,
    vaults: parsed.vaults,
    items: parsed.items,
    folders: parsed.folders,
  };

  const canonical = canonicalBody(body);
  const digest = await sha256(canonical);

  let signature: Uint8Array;
  try {
    signature = fromBase64(parsed.envelopeMac);
  } catch {
    throw new EnvelopeSignatureError("envelope_mac is not valid base64");
  }

  const publicKey = await importEd25519PublicKey(identityPublicKeyRaw);
  const ok = await ed25519Verify(publicKey, signature, digest);
  if (!ok) {
    throw new EnvelopeSignatureError("signature did not verify");
  }
  return body;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * canonicalBody emits the bytes that the signer signs and the verifier
 * verifies. Both sides MUST walk the same object keys in the same order.
 */
function canonicalBody(body: ExportEnvelopeBody): Uint8Array {
  // Coerce to plain JSONValue so the canonicalizer's type check is happy.
  const asJson: JSONValue = {
    version: body.version,
    createdAt: body.createdAt,
    userId: body.userId,
    vaults: body.vaults.map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type,
      createdAt: v.createdAt,
    })),
    items: body.items.map((it) => ({
      id: it.id,
      vaultId: it.vaultId,
      // Optional folderId becomes null when absent so the canonical shape
      // stays stable regardless of whether the source omitted the field.
      folderId: it.folderId ?? null,
      itemType: it.itemType,
      encryptedData: it.encryptedData,
      encryptedName: it.encryptedName,
      favorite: it.favorite,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    })),
    folders: body.folders.map((f) => ({
      id: f.id,
      vaultId: f.vaultId,
      encryptedName: f.encryptedName,
      createdAt: f.createdAt,
    })),
  };
  return canonicalize(asJson);
}

function assertEnvelopeShape(value: unknown): asserts value is ExportEnvelope {
  if (typeof value !== "object" || value === null) {
    throw new EnvelopeError("envelope is not a JSON object");
  }
  const obj = value as Record<string, unknown>;
  const required: Array<keyof ExportEnvelope> = [
    "version",
    "createdAt",
    "userId",
    "vaults",
    "items",
    "folders",
    "envelopeMac",
  ];
  for (const key of required) {
    if (!(key in obj)) {
      throw new EnvelopeError(`envelope missing required field "${key}"`);
    }
  }
  if (typeof obj.version !== "number") {
    throw new EnvelopeError(`version must be number, got ${typeof obj.version}`);
  }
  if (typeof obj.createdAt !== "string") {
    throw new EnvelopeError("createdAt must be string");
  }
  if (typeof obj.userId !== "string") {
    throw new EnvelopeError("userId must be string");
  }
  if (typeof obj.envelopeMac !== "string") {
    throw new EnvelopeError("envelopeMac must be string");
  }
  if (!Array.isArray(obj.vaults)) {
    throw new EnvelopeError("vaults must be array");
  }
  if (!Array.isArray(obj.items)) {
    throw new EnvelopeError("items must be array");
  }
  if (!Array.isArray(obj.folders)) {
    throw new EnvelopeError("folders must be array");
  }
}
