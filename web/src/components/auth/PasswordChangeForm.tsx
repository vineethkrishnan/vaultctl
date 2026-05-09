// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { apiPost, ApiRequestError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import {
  deriveKeys,
  fromBase64,
  toBase64,
  aesGcmEncrypt,
  serializeBlob,
} from "@/shared/crypto";
import { workerDecrypt } from "@/worker/worker-client";

interface Props {
  onComplete: () => void;
}

/**
 * Password change flow:
 * 1. Enter old + new master password
 * 2. Client: derive old authHash + new stretchedKey
 * 3. Client: decrypt private keys with old stretchedKey (via Worker)
 * 4. Client: re-encrypt with new stretchedKey
 * 5. POST /auth/password/change
 * 6. Re-init key custody with new credentials
 */
export function PasswordChangeForm({ onComplete }: Props) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (newPassword.length < 10) {
      setError("New password must be at least 10 characters");
      return;
    }

    setLoading(true);
    try {
      const salt = fromBase64(sessionStorage.getItem("vaultctl_salt") ?? "");
      const kdfIter = Number(sessionStorage.getItem("vaultctl_kdf_iter") ?? "3");
      const kdfMem = Number(sessionStorage.getItem("vaultctl_kdf_mem") ?? "65536");
      const kdfPar = Number(sessionStorage.getItem("vaultctl_kdf_par") ?? "4");
      const kdfParams = { iterations: kdfIter, memoryKB: kdfMem, parallelism: kdfPar };

      // Derive old and new keys
      const { authHash: oldAuthHash } = await deriveKeys(oldPassword, salt, kdfParams);
      const { authHash: newAuthHash, stretchedKey: newStretchedKey } = await deriveKeys(
        newPassword, salt, kdfParams,
      );

      // Decrypt current private keys via Worker, then re-encrypt with new stretchedKey
      const loginRes = sessionStorage.getItem("vaultctl_login_enc_priv") ?? "";
      const loginIdRes = sessionStorage.getItem("vaultctl_login_enc_id_priv") ?? "";

      // Re-encrypt private keys: decrypt from b64 blob via worker, re-encrypt with new key
      const privKeyBytes = await workerDecrypt("__privkey__", loginRes).catch(() => {
        throw new Error("Could not decrypt current private key — try logging in again");
      });
      const idPrivKeyBytes = await workerDecrypt("__idprivkey__", loginIdRes).catch(() => {
        throw new Error("Could not decrypt current identity key — try logging in again");
      });

      const newEncPriv = await aesGcmEncrypt(newStretchedKey, privKeyBytes);
      const newEncIdPriv = await aesGcmEncrypt(newStretchedKey, idPrivKeyBytes);

      const res = await apiPost<{
        accessToken: string;
        refreshToken: string;
        refreshExpiresAt: string;
      }>("/api/v1/auth/password/change", {
        oldAuthHash: toBase64(oldAuthHash),
        newAuthHash: toBase64(newAuthHash),
        encryptedPrivateKey: toBase64(serializeBlob(newEncPriv)),
        encryptedIdentityPrivateKey: toBase64(serializeBlob(newEncIdPriv)),
      });

      // Update auth state with new tokens
      useAuthStore.getState().setAuth({
        userId: useAuthStore.getState().userId ?? "",
        role: useAuthStore.getState().role ?? "",
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        sessionId: useAuthStore.getState().sessionId ?? "",
      });

      onComplete();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.error.code === "INVALID_CREDENTIALS") {
          setError("Current password is incorrect");
        } else {
          setError(err.error.message);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Password change failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h3 className="font-semibold">Change Master Password</h3>

      {error && (
        <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
      )}

      <div className="space-y-1">
        <label className="text-sm font-medium">Current Password</label>
        <input
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">New Password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={10}
          autoComplete="new-password"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Confirm New Password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
        />
      </div>

      <button
        type="submit"
        disabled={loading || !oldPassword || !newPassword || !confirmPassword}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? "Changing password..." : "Change Password"}
      </button>
    </form>
  );
}
