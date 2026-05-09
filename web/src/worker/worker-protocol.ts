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
      // private key. Used by the M9 export envelope flow — the private key
      // never leaves this worker; the main thread receives only the raw
      // signature bytes.
      op: "signIdentity";
      requestId: string;
      message: ArrayBuffer;
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
