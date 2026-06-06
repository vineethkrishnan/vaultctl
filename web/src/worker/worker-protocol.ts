// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Message types shared between the main thread and the crypto Web Worker.
 * Keep this file free of DOM or Worker-specific imports.
 */

export interface VaultKeyMaterial {
  vaultId: string;
  encryptedVaultKey: string; // base64 wire blob
  vaultType: "personal" | "shared";
}

// ===========================================================================
// Main → Worker requests
// ===========================================================================

export type WorkerRequest =
  | {
      op: "init";
      requestId: string;
      stretchedKey: ArrayBuffer;
      encryptedPrivateKey: string;
      encryptedIdentityPrivateKey: string;
      vaults: VaultKeyMaterial[];
    }
  | { op: "encrypt"; requestId: string; vaultId: string; plaintext: ArrayBuffer }
  | { op: "decrypt"; requestId: string; vaultId: string; blob: string }
  | { op: "encryptName"; requestId: string; vaultId: string; name: string }
  | { op: "decryptName"; requestId: string; vaultId: string; blob: string }
  | { op: "lock" }
  | { op: "isUnlocked"; requestId: string }
  | {
      op: "verifyPassword";
      requestId: string;
      password: string;
      salt: string;
      kdfIterations: number;
      kdfMemoryKB: number;
      kdfParallelism: number;
    }
  | {
      // signIdentity: sign arbitrary bytes with the loaded Ed25519 identity
      // private key. Used by the M9 export envelope flow - the private key
      // never leaves this worker; the main thread receives only the raw
      // signature bytes.
      op: "signIdentity";
      requestId: string;
      message: ArrayBuffer;
    }
  | {
      // wrapVaultKey: re-wrap a held vault key to a recipient's RSA public key
      // and sign the wrap with the identity key (M8 sharing / H1). The recipient
      // key is verified against their identity key first; the raw vault key and
      // identity private key never leave the worker - only the wrapped blob and
      // signature (base64) come back.
      op: "wrapVaultKey";
      requestId: string;
      vaultId: string;
      recipientUserId: string;
      recipientPublicKey: string; // base64 SPKI (RSA wrapping key)
      recipientIdentityPublicKey: string; // base64 raw Ed25519 identity key
      recipientPublicKeySignature: string; // base64 Ed25519(idPriv, publicKey)
    }
  | {
      // createVaultKey: generate a fresh personal vault key, AES-KW wrap it
      // under the held stretchedKey, and sign the serialized wrap with the
      // identity key (mirrors the owner's self-wrap at registration). The raw
      // key is buffered under `handle` so it can be bound to the server-assigned
      // vault id once the vault is created. The wrapped blob and signature
      // (base64) come back; the raw vault key never leaves the worker.
      op: "createVaultKey";
      requestId: string;
      handle: string;
    }
  | {
      // bindVaultKey: move a buffered new-vault key from its temporary handle
      // to the real, server-assigned vault id so subsequent encrypt/decrypt for
      // that vault works without re-login.
      op: "bindVaultKey";
      requestId: string;
      handle: string;
      vaultId: string;
    };

// ===========================================================================
// Worker → Main responses
// ===========================================================================

export type WorkerResponse =
  | { op: "ready" }
  | { op: "initDone"; requestId: string }
  | { op: "result"; requestId: string; data: ArrayBuffer }
  | { op: "resultString"; requestId: string; value: string }
  | { op: "resultBool"; requestId: string; value: boolean }
  | { op: "error"; requestId: string; message: string }
  | { op: "locked" };
