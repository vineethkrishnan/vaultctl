/**
 * React hook wrapping the crypto Worker client.
 *
 * Provides encrypt/decrypt/lock functions and wires the "locked" event
 * to the auth store.
 */

import { useEffect } from "react";
import { useAuthStore } from "@/lib/auth-store";
import {
  setOnLocked,
  workerEncrypt,
  workerDecrypt,
  workerEncryptName,
  workerDecryptName,
  workerLock,
  workerTerminate,
} from "@/worker/worker-client";

export function useCryptoWorker() {
  const lockStore = useAuthStore((s) => s.lock);

  useEffect(() => {
    setOnLocked(() => {
      lockStore();
    });
  }, [lockStore]);

  return {
    encrypt: workerEncrypt,
    decrypt: workerDecrypt,
    encryptName: workerEncryptName,
    decryptName: workerDecryptName,
    lock: workerLock,
    terminate: workerTerminate,
  };
}
