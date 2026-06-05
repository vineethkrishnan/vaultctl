// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useAuthStore } from "@/lib/auth-store";
import { apiGet, apiPost, ApiRequestError } from "@/lib/api-client";
import { initKeys } from "@/lib/key-holder";
import {
  deriveKeys,
  parseRecoveryKey,
  recoverPrivateKeyFromBytes,
  aesGcmEncrypt,
  serializeBlob,
  fromBase64,
  toBase64,
  zero,
} from "@/shared/crypto";
import type { LoginResponse } from "@/shared/types/api";
import { deviceLabel } from "@/lib/device";
import { BrandMark } from "@/components/BrandMark";

interface RecoveryVerifyResponse {
  recoveryWrappedPrivateKey: string;
  recoveryWrappedIdentityPrivateKey: string;
  salt: string;
  iterations: number;
  memoryKB: number;
  parallelism: number;
}

interface ResetResponse {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

/**
 * Forgot-password recovery. The user proves possession of their recovery key
 * by decrypting the recovery-wrapped private keys client-side, then re-wraps
 * them under a brand-new master password. The server never sees the recovery
 * key or any plaintext key - only the re-encrypted blobs and the new auth hash.
 */
export function RecoveryPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [step, setStep] = useState<"email" | "reset" | "nokit">("email");
  const [email, setEmail] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [material, setMaterial] = useState<RecoveryVerifyResponse | null>(null);
  const [hint, setHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiPost<RecoveryVerifyResponse>(
        "/api/v1/auth/recovery/verify",
        { email },
      );
      if (!res.recoveryWrappedPrivateKey || !res.recoveryWrappedIdentityPrivateKey) {
        // No recovery kit was ever stored for this account, so the kit can't
        // help here. Surface the password hint (if any) to jog their memory
        // instead of sending them in a circle.
        try {
          const h = await apiGet<{ hint: string }>(
            `/api/v1/auth/password/hint?email=${encodeURIComponent(email)}`,
          );
          setHint(h.hint ?? "");
        } catch {
          setHint("");
        }
        setStep("nokit");
        return;
      }
      setMaterial(res);
      setStep("reset");
    } catch (err) {
      // The server returns the same error for unknown emails to avoid
      // leaking which accounts exist.
      if (err instanceof ApiRequestError) setError(err.error.message);
      else setError("Connection failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!material) return;
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
    let recoveryKeyBytes: Uint8Array | null = null;
    try {
      try {
        recoveryKeyBytes = parseRecoveryKey(recoveryKey.trim());
      } catch {
        setError("That doesn't look like a valid recovery key");
        return;
      }

      // Prove the recovery key by decrypting the wrapped private keys.
      let rsaPrivKey: Uint8Array;
      let idPrivKey: Uint8Array;
      try {
        rsaPrivKey = await recoverPrivateKeyFromBytes(
          recoveryKeyBytes,
          fromBase64(material.recoveryWrappedPrivateKey),
        );
        idPrivKey = await recoverPrivateKeyFromBytes(
          recoveryKeyBytes,
          fromBase64(material.recoveryWrappedIdentityPrivateKey),
        );
      } catch {
        setError("Incorrect recovery key for this account");
        return;
      }

      // The reset keeps the existing salt + KDF params, so derive the new keys
      // against them, then re-wrap the private keys under the new stretched key.
      const kdfParams = {
        iterations: material.iterations,
        memoryKB: material.memoryKB,
        parallelism: material.parallelism,
      };
      const { authHash: newAuthHash, stretchedKey: newStretchedKey } =
        await deriveKeys(newPassword, fromBase64(material.salt), kdfParams);
      const encPriv = await aesGcmEncrypt(newStretchedKey, rsaPrivKey);
      const encIdPriv = await aesGcmEncrypt(newStretchedKey, idPrivKey);
      zero(rsaPrivKey);
      zero(idPrivKey);

      await apiPost<ResetResponse>("/api/v1/auth/recovery/reset", {
        email,
        newAuthHash: toBase64(newAuthHash),
        encryptedPrivateKey: toBase64(serializeBlob(encPriv)),
        encryptedIdentityPrivateKey: toBase64(serializeBlob(encIdPriv)),
      });

      // Sign in with the new password to enter the vault directly.
      const loginRes = await apiPost<LoginResponse>("/api/v1/auth/login", {
        email,
        authHash: toBase64(newAuthHash),
        deviceName: await deviceLabel(),
      });
      setAuth({
        userId: loginRes.userId,
        role: loginRes.role,
        accessToken: loginRes.accessToken,
        refreshToken: loginRes.refreshToken,
        sessionId: loginRes.sessionId,
      });
      sessionStorage.setItem("vaultctl_email", email);
      sessionStorage.setItem("vaultctl_salt", material.salt);
      sessionStorage.setItem("vaultctl_kdf_iter", String(material.iterations));
      sessionStorage.setItem("vaultctl_kdf_mem", String(material.memoryKB));
      sessionStorage.setItem("vaultctl_kdf_par", String(material.parallelism));
      sessionStorage.setItem("vaultctl_id_pubkey", loginRes.identityPublicKey);
      sessionStorage.setItem("vaultctl_login_enc_priv", loginRes.encryptedPrivateKey);
      sessionStorage.setItem(
        "vaultctl_login_enc_id_priv",
        loginRes.encryptedIdentityPrivateKey,
      );

      await initKeys({
        stretchedKey: newStretchedKey,
        encryptedPrivateKey: loginRes.encryptedPrivateKey,
        encryptedIdentityPrivateKey: loginRes.encryptedIdentityPrivateKey,
        vaults: loginRes.vaults,
      });

      const firstVault = loginRes.vaults[0];
      navigate({
        to: "/vault/$vaultId",
        params: { vaultId: firstVault ? firstVault.vaultId : "none" },
      });
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.error.message);
      else setError(err instanceof Error ? err.message : "Recovery failed");
    } finally {
      if (recoveryKeyBytes) zero(recoveryKeyBytes);
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="flex flex-col items-center space-y-3 text-center">
          <BrandMark className="text-7xl text-brand" />
          <h1 className="text-xl font-bold">Recover your vault</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Use your recovery key to set a new master password. Your vault data
            is preserved.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {step === "email" ? (
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="rec-email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="rec-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                placeholder="you@example.com"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Checking..." : "Continue"}
            </button>
          </form>
        ) : step === "nokit" ? (
          <div className="rounded-md border border-border bg-card p-4 text-sm">
            <p className="font-medium">No recovery kit on file for this account.</p>
            {hint ? (
              <>
                <p className="mt-1.5 text-muted-foreground">
                  Your master password can&apos;t be reset without a recovery kit, but
                  here&apos;s the hint you saved:
                </p>
                <p className="mt-2 rounded-md bg-accent/40 px-3 py-2 font-mono">{hint}</p>
                <p className="mt-2 text-muted-foreground">
                  If that jogs your memory, head back and sign in. Once you&apos;re in,
                  create a recovery kit from Settings so this can&apos;t happen again.
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-muted-foreground">
                vaultctl is zero-knowledge: without your master password or a recovery kit,
                the vault cannot be decrypted &mdash; not by you, not by an administrator.
                If your instance has an administrator, contact them. Once you can sign in,
                create a recovery kit from Settings so this can&apos;t happen again.
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="rec-key" className="text-sm font-medium">
                Recovery key
              </label>
              <textarea
                id="rec-key"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
                required
                autoFocus
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none ring-ring focus:ring-2"
                placeholder="XXXX-XXXX-XXXX-..."
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="rec-pw" className="text-sm font-medium">
                New master password
              </label>
              <input
                id="rec-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={10}
                autoComplete="new-password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="rec-pw2" className="text-sm font-medium">
                Confirm new password
              </label>
              <input
                id="rec-pw2"
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
              disabled={loading || !recoveryKey || !newPassword || !confirmPassword}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Recovering..." : "Reset master password"}
            </button>
          </form>
        )}

        <div className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="text-primary underline">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
