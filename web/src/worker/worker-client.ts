// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Promise-based client for the crypto Web Worker.
 *
 * Each request carries a unique requestId. The Worker posts back a response
 * with the same requestId, which resolves the corresponding promise.
 *
 * On "locked" event from the Worker, the onLocked callback fires.
 */

import type {
  WorkerRequest,
  WorkerResponse,
  VaultKeyMaterial,
} from "./worker-protocol.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<string, Pending>();
let onLockedCallback: (() => void) | null = null;
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;

function getRequestId(): string {
  return `r${++nextId}`;
}

function ensureWorker(): Worker {
  if (worker) return worker;

  readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  worker = new Worker(new URL("./crypto-worker.ts", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;

    switch (msg.op) {
      case "ready":
        readyResolve?.();
        break;

      case "locked":
        onLockedCallback?.();
        break;

      case "initDone":
      case "result":
      case "resultString":
      case "resultBool": {
        const p = pending.get(msg.requestId);
        if (p) {
          pending.delete(msg.requestId);
          if (msg.op === "result") p.resolve(msg.data);
          else if (msg.op === "resultString") p.resolve(msg.value);
          else if (msg.op === "resultBool") p.resolve(msg.value);
          else p.resolve(undefined);
        }
        break;
      }

      case "error": {
        const p = pending.get(msg.requestId);
        if (p) {
          pending.delete(msg.requestId);
          p.reject(new Error(msg.message));
        }
        break;
      }
    }
  };

  worker.onerror = (e) => {
    // Reject all pending
    for (const [, p] of pending) {
      p.reject(new Error(`Worker error: ${e.message}`));
    }
    pending.clear();
  };

  return worker;
}

function send<T>(msg: Record<string, unknown>): Promise<T> {
  const requestId = getRequestId();
  const fullMsg = { ...msg, requestId };

  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    ensureWorker().postMessage(fullMsg);
  });
}

// ===========================================================================
// Public API
// ===========================================================================

/** Set callback for when the Worker auto-locks. */
export function setOnLocked(callback: () => void) {
  onLockedCallback = callback;
}

/** Wait for the Worker to be ready. */
export async function waitReady(): Promise<void> {
  ensureWorker();
  await readyPromise;
}

/** Initialize key custody. stretchedKey is transferred (zeroed on main thread). */
export async function workerInit(params: {
  stretchedKey: Uint8Array;
  encryptedPrivateKey: string;
  encryptedIdentityPrivateKey: string;
  vaults: VaultKeyMaterial[];
}): Promise<void> {
  await waitReady();
  // Transfer stretchedKey to Worker (zero-copy), main thread loses access
  const skBuffer = params.stretchedKey.buffer.slice(
    params.stretchedKey.byteOffset,
    params.stretchedKey.byteOffset + params.stretchedKey.byteLength,
  );
  await send({
    op: "init",
    stretchedKey: skBuffer,
    encryptedPrivateKey: params.encryptedPrivateKey,
    encryptedIdentityPrivateKey: params.encryptedIdentityPrivateKey,
    vaults: params.vaults,
  });
}

/** Encrypt item data. Returns base64 wire blob. */
export async function workerEncrypt(
  vaultId: string,
  plaintext: Uint8Array,
): Promise<string> {
  const buf = plaintext.buffer.slice(
    plaintext.byteOffset,
    plaintext.byteOffset + plaintext.byteLength,
  );
  return send<string>({ op: "encrypt", vaultId, plaintext: buf });
}

/** Decrypt item data. Returns plaintext bytes. */
export async function workerDecrypt(
  vaultId: string,
  blobB64: string,
): Promise<Uint8Array> {
  const ab = await send<ArrayBuffer>({ op: "decrypt", vaultId, blob: blobB64 });
  return new Uint8Array(ab);
}

/** Encrypt item name with padding. Returns base64 wire blob. */
export async function workerEncryptName(
  vaultId: string,
  name: string,
): Promise<string> {
  return send<string>({ op: "encryptName", vaultId, name });
}

/** Decrypt item name (removes padding). Returns plain string. */
export async function workerDecryptName(
  vaultId: string,
  blobB64: string,
): Promise<string> {
  return send<string>({ op: "decryptName", vaultId, blob: blobB64 });
}

/** Check if the Worker has keys loaded. */
export async function workerIsUnlocked(): Promise<boolean> {
  return send<boolean>({ op: "isUnlocked" });
}

/** Verify master password by re-deriving stretchedKey and comparing. */
export async function workerVerifyPassword(params: {
  password: string;
  salt: string;
  kdfIterations: number;
  kdfMemoryKB: number;
  kdfParallelism: number;
}): Promise<boolean> {
  return send<boolean>({
    op: "verifyPassword",
    password: params.password,
    salt: params.salt,
    kdfIterations: params.kdfIterations,
    kdfMemoryKB: params.kdfMemoryKB,
    kdfParallelism: params.kdfParallelism,
  });
}

/**
 * Sign arbitrary bytes with the Ed25519 identity private key held in the
 * Worker. The key never crosses back to the main thread; only the 64-byte
 * signature does. Used by the M9 export envelope flow.
 */
export async function workerSignIdentity(
  message: Uint8Array,
): Promise<Uint8Array> {
  const buf = message.buffer.slice(
    message.byteOffset,
    message.byteOffset + message.byteLength,
  );
  const ab = await send<ArrayBuffer>({ op: "signIdentity", message: buf });
  return new Uint8Array(ab);
}

export interface WrapVaultKeyResult {
  encryptedVaultKey: string; // base64 wire blob (RSA-OAEP)
  wrapSignature: string; // base64 Ed25519 signature
}

/**
 * Re-wrap a held vault key to a recipient and sign the wrap (M8 sharing). The
 * Worker verifies the recipient's public key against their identity key before
 * wrapping. The raw vault key and identity private key never leave the Worker.
 */
export async function workerWrapVaultKey(params: {
  vaultId: string;
  recipientUserId: string;
  recipientPublicKey: string; // base64 SPKI
  recipientIdentityPublicKey: string; // base64 raw Ed25519
  recipientPublicKeySignature: string; // base64 Ed25519 signature
}): Promise<WrapVaultKeyResult> {
  const json = await send<string>({
    op: "wrapVaultKey",
    vaultId: params.vaultId,
    recipientUserId: params.recipientUserId,
    recipientPublicKey: params.recipientPublicKey,
    recipientIdentityPublicKey: params.recipientIdentityPublicKey,
    recipientPublicKeySignature: params.recipientPublicKeySignature,
  });
  return JSON.parse(json) as WrapVaultKeyResult;
}

export interface CreateVaultKeyResult {
  encryptedVaultKey: string; // base64 wire blob (alg=AES-256-KW)
  wrapSignature: string; // base64 Ed25519 signature
}

/**
 * Generate a fresh personal vault key inside the Worker, AES-KW wrap it under
 * the held stretchedKey, and sign the wrap with the identity key (M9 create
 * vault). The raw key is buffered under `handle`; call workerBindVaultKey with
 * the server-assigned vault id afterwards so the new vault is usable in-session.
 * The raw vault key never leaves the Worker.
 */
export async function workerCreateVaultKey(
  handle: string,
): Promise<CreateVaultKeyResult> {
  const json = await send<string>({ op: "createVaultKey", handle });
  return JSON.parse(json) as CreateVaultKeyResult;
}

/** Bind a buffered new-vault key (by handle) to its server-assigned vault id. */
export async function workerBindVaultKey(
  handle: string,
  vaultId: string,
): Promise<void> {
  await send({ op: "bindVaultKey", handle, vaultId });
}

/** Lock: zero all keys in the Worker. */
export function workerLock(): void {
  if (worker) {
    worker.postMessage({ op: "lock" } satisfies WorkerRequest);
  }
}

/** Terminate the Worker entirely (logout). */
export function workerTerminate(): void {
  if (worker) {
    worker.postMessage({ op: "lock" } satisfies WorkerRequest);
    worker.terminate();
    worker = null;
    readyPromise = null;
    pending.clear();
  }
}
