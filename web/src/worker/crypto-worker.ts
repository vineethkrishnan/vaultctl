/**
 * Crypto Web Worker — holds all decrypted key material in isolated scope.
 *
 * Keys NEVER cross to the main thread. The main thread communicates via
 * postMessage with opaque request/response pairs.
 *
 * Security (M9): stretchedKey, RSA private key, Ed25519 identity key, and
 * all vault keys live here. On lock, everything is zeroed.
 */

import {
  aesGcmEncrypt,
  aesGcmDecrypt,
  aesKeyUnwrap,
  parseBlob,
  serializeBlob,
  fromBase64,
  toBase64,
  pad,
  unpad,
  zero,
  AlgID,
  deriveKeys,
  timingSafeEqual,
  importRSAPrivateKey,
  importEd25519PrivateKey,
  ed25519Sign,
  rsaOaepDecrypt,
} from "../shared/crypto/index.js";
import type {
  WorkerRequest,
  WorkerResponse,
} from "./worker-protocol.js";

// Module-scoped key material
let stretchedKey: Uint8Array | null = null;
let rsaPrivateKey: CryptoKey | null = null;
const vaultKeys = new Map<string, Uint8Array>();
// identityKey.value stored alongside other keys for signing (sharing flow).
// Kept in a container to avoid TS noUnusedLocals since read access is Phase 5+.
const identityKey: { value: CryptoKey | null } = { value: null };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Auto-lock timer
let lockTimer: ReturnType<typeof setTimeout> | undefined;
const LOCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes default

function resetLockTimer() {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(() => doLock(), LOCK_TIMEOUT_MS);
}

function doLock() {
  if (stretchedKey) {
    zero(stretchedKey);
    stretchedKey = null;
  }
  rsaPrivateKey = null;
  identityKey.value = null;
  for (const [, key] of vaultKeys) {
    zero(key);
  }
  vaultKeys.clear();
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = undefined;
  }
  respond({ op: "locked" });
}

function respond(msg: WorkerResponse) {
  self.postMessage(msg);
}

function getVaultKey(vaultId: string): Uint8Array {
  const key = vaultKeys.get(vaultId);
  if (!key) throw new Error(`No key for vault ${vaultId}`);
  return key;
}

// ===========================================================================
// Message handler
// ===========================================================================

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  // Every message (except lock) resets the auto-lock timer
  if (msg.op !== "lock") {
    resetLockTimer();
  }

  try {
    switch (msg.op) {
      case "init": {
        const sk = new Uint8Array(msg.stretchedKey);
        stretchedKey = sk;

        // Decrypt RSA private key
        const encPrivBlob = parseBlob(fromBase64(msg.encryptedPrivateKey));
        const rsaPrivBytes = await aesGcmDecrypt(sk, encPrivBlob);
        rsaPrivateKey = await importRSAPrivateKey(rsaPrivBytes);
        zero(rsaPrivBytes);

        // Decrypt Ed25519 identity private key
        const encIdPrivBlob = parseBlob(fromBase64(msg.encryptedIdentityPrivateKey));
        const ed25519PrivBytes = await aesGcmDecrypt(sk, encIdPrivBlob);
        identityKey.value = await importEd25519PrivateKey(ed25519PrivBytes);
        zero(ed25519PrivBytes);

        // Decrypt vault keys
        for (const vm of msg.vaults) {
          const blob = parseBlob(fromBase64(vm.encryptedVaultKey));
          let vaultKeyBytes: Uint8Array;

          if (blob.alg === AlgID.AES_256_KW) {
            vaultKeyBytes = await aesKeyUnwrap(sk, blob);
          } else if (blob.alg === AlgID.RSA_OAEP_SHA256) {
            if (!rsaPrivateKey) throw new Error("RSA private key not loaded");
            vaultKeyBytes = await rsaOaepDecrypt(rsaPrivateKey, blob);
          } else {
            throw new Error(`Unsupported vault key alg: 0x${blob.alg.toString(16)}`);
          }

          vaultKeys.set(vm.vaultId, vaultKeyBytes);
        }

        respond({ op: "initDone", requestId: msg.requestId });
        break;
      }

      case "encrypt": {
        const key = getVaultKey(msg.vaultId);
        const plaintext = new Uint8Array(msg.plaintext);
        const blob = await aesGcmEncrypt(key, plaintext);
        const wire = serializeBlob(blob);
        const b64 = toBase64(wire);
        respond({
          op: "resultString",
          requestId: msg.requestId,
          value: b64,
        });
        break;
      }

      case "decrypt": {
        const key = getVaultKey(msg.vaultId);
        const blob = parseBlob(fromBase64(msg.blob));
        const plaintext = await aesGcmDecrypt(key, blob);
        respond({
          op: "result",
          requestId: msg.requestId,
          data: plaintext.buffer.slice(
            plaintext.byteOffset,
            plaintext.byteOffset + plaintext.byteLength,
          ) as ArrayBuffer,
        });
        break;
      }

      case "encryptName": {
        const key = getVaultKey(msg.vaultId);
        const padded = pad(encoder.encode(msg.name));
        const blob = await aesGcmEncrypt(key, padded);
        const wire = serializeBlob(blob);
        respond({
          op: "resultString",
          requestId: msg.requestId,
          value: toBase64(wire),
        });
        break;
      }

      case "decryptName": {
        const key = getVaultKey(msg.vaultId);
        const blob = parseBlob(fromBase64(msg.blob));
        const padded = await aesGcmDecrypt(key, blob);
        const name = decoder.decode(unpad(padded));
        respond({
          op: "resultString",
          requestId: msg.requestId,
          value: name,
        });
        break;
      }

      case "isUnlocked": {
        respond({
          op: "resultBool",
          requestId: msg.requestId,
          value: stretchedKey !== null,
        });
        break;
      }

      case "signIdentity": {
        if (!identityKey.value) {
          respond({
            op: "error",
            requestId: msg.requestId,
            message: "Identity key not loaded",
          });
          break;
        }
        const message = new Uint8Array(msg.message);
        const sig = await ed25519Sign(identityKey.value, message);
        respond({
          op: "result",
          requestId: msg.requestId,
          data: sig.buffer.slice(
            sig.byteOffset,
            sig.byteOffset + sig.byteLength,
          ) as ArrayBuffer,
        });
        break;
      }

      case "verifyPassword": {
        if (!stretchedKey) {
          respond({ op: "error", requestId: msg.requestId, message: "Keys not loaded" });
          break;
        }
        // Re-derive stretchedKey from the provided password and compare
        const salt = fromBase64(msg.salt);
        const { stretchedKey: derived } = await deriveKeys(msg.password, salt, {
          iterations: msg.kdfIterations,
          memoryKB: msg.kdfMemoryKB,
          parallelism: msg.kdfParallelism,
        });
        const match = timingSafeEqual(stretchedKey, derived);
        zero(derived);
        respond({ op: "resultBool", requestId: msg.requestId, value: match });
        break;
      }

      case "lock": {
        doLock();
        break;
      }
    }
  } catch (err) {
    if ("requestId" in msg) {
      respond({
        op: "error",
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};

// Signal ready
respond({ op: "ready" });
