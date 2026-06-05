// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { apiPost, ApiRequestError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import {
  deriveKeys,
  aesGcmDecrypt,
  parseBlob,
  serializeBlob,
  fromBase64,
  toBase64,
  zero,
  generateRecoveryKit,
  formatRecoveryKey,
} from "@/shared/crypto";
import { RecoveryKitDownload } from "@/components/auth/RecoveryKitDownload";

/**
 * Regenerate the recovery kit. Re-verifies the master password (step-up),
 * derives the stretched key to decrypt the current private keys locally, wraps
 * them under a brand-new recovery key, and stores the new wrapped blobs. The
 * old recovery key is invalidated server-side the moment the new one lands.
 */
export function RecoveryKitSetting() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  async function regenerate() {
    setError(null);
    if (!password) {
      setError("Enter your master password");
      return;
    }
    const encPrivB64 = sessionStorage.getItem("vaultctl_login_enc_priv") ?? "";
    const encIdPrivB64 = sessionStorage.getItem("vaultctl_login_enc_id_priv") ?? "";
    if (!encPrivB64 || !encIdPrivB64) {
      setError("Please sign out and back in, then regenerate your recovery kit");
      return;
    }

    setBusy(true);
    let stretchedKey: Uint8Array | null = null;
    let rsaPriv: Uint8Array | null = null;
    let idPriv: Uint8Array | null = null;
    try {
      const salt = fromBase64(sessionStorage.getItem("vaultctl_salt") ?? "");
      const kdfParams = {
        iterations: Number(sessionStorage.getItem("vaultctl_kdf_iter") ?? "3"),
        memoryKB: Number(sessionStorage.getItem("vaultctl_kdf_mem") ?? "65536"),
        parallelism: Number(sessionStorage.getItem("vaultctl_kdf_par") ?? "4"),
      };
      const derived = await deriveKeys(password, salt, kdfParams);
      stretchedKey = derived.stretchedKey;

      // Step up (verifies the password and grants the claim the rotate
      // endpoint requires).
      const stepUp = await apiPost<{ accessToken: string }>("/api/v1/auth/step-up", {
        authHash: toBase64(derived.authHash),
      });
      useAuthStore
        .getState()
        .setTokens(stepUp.accessToken, useAuthStore.getState().refreshToken ?? "");

      rsaPriv = await aesGcmDecrypt(stretchedKey, parseBlob(fromBase64(encPrivB64)));
      idPriv = await aesGcmDecrypt(stretchedKey, parseBlob(fromBase64(encIdPrivB64)));

      const { recoveryKey, recoveryWrappedPrivKey, recoveryWrappedIdentityPrivKey } =
        await generateRecoveryKit(rsaPriv, idPriv);
      await apiPost("/api/v1/auth/recovery/rotate", {
        recoveryWrappedPrivateKey: toBase64(serializeBlob(recoveryWrappedPrivKey)),
        recoveryWrappedIdentityPrivateKey: toBase64(
          serializeBlob(recoveryWrappedIdentityPrivKey),
        ),
      });
      setNewKey(formatRecoveryKey(recoveryKey));
      zero(recoveryKey);
      setPassword("");
      setOpen(false);
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === "INVALID_CREDENTIALS") {
        setError("Incorrect master password");
      } else {
        setError(err instanceof Error ? err.message : "Could not regenerate recovery kit");
      }
    } finally {
      if (stretchedKey) zero(stretchedKey);
      if (rsaPriv) zero(rsaPriv);
      if (idPriv) zero(idPriv);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <KeyRound className="h-3.5 w-3.5 text-brand" />
            Recovery Kit
          </span>
          <span className="block text-xs text-muted-foreground">
            A spare key that resets your master password if you forget it.
            Regenerating invalidates the old one immediately.
          </span>
        </span>
        {!newKey && (
          <button
            onClick={() => {
              setOpen((v) => !v);
              setError(null);
            }}
            className="shrink-0 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            {open ? "Cancel" : "Regenerate"}
          </button>
        )}
      </div>

      {open && !newKey && (
        <div className="space-y-2 pt-1">
          {error && (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Master password"
            autoComplete="current-password"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
          <button
            onClick={regenerate}
            disabled={busy}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Generating..." : "Generate new recovery kit"}
          </button>
        </div>
      )}

      {error && !open && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>
      )}

      {newKey && (
        <div className="space-y-3 pt-1">
          <p className="text-xs text-muted-foreground">
            Save this recovery key somewhere safe and private. It will not be shown
            again, and it replaces any earlier kit.
          </p>
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
            If you lose this key <strong>and</strong> forget your master password, your
            vault is lost for good &mdash; zero-knowledge means no one can recover it.
          </div>
          <div className="rounded-md border border-border bg-card p-3 font-mono text-sm break-all select-all">
            {newKey}
          </div>
          <RecoveryKitDownload recoveryKey={newKey} />
          <button
            onClick={() => setNewKey(null)}
            className="rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
