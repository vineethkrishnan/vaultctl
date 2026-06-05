// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { apiPost, ApiRequestError } from "@/lib/api-client";
import { deriveKeys, fromBase64, toBase64 } from "@/shared/crypto";
import { useAuthStore } from "@/lib/auth-store";
import { ShieldCheck, Fingerprint } from "lucide-react";
import {
  isBiometricAvailable,
  isBiometricEnrolled,
  unlockWithBiometric,
} from "@/lib/biometric";

interface Props {
  open: boolean;
  onSuccess: (newAccessToken: string) => void;
  onCancel: () => void;
}

/**
 * Step-up modal - re-verifies master password and obtains a fresh JWT
 * with step-up claim. Called when an API returns 403 STEP_UP_REQUIRED.
 */
export function StepUpModal({ open, onSuccess, onCancel }: Props) {
  const { t } = useTranslation(["security", "common"]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
      void (async () => {
        setBioEnrolled((await isBiometricAvailable()) && isBiometricEnrolled());
      })();
    }
  }, [open]);

  // Biometric step-up: recover the master-password proof (authHash) via Touch
  // ID and exchange it for a fresh step-up token, no typing required.
  async function handleBiometric() {
    setError(null);
    setLoading(true);
    try {
      const { secret } = await unlockWithBiometric();
      const res = await apiPost<{ accessToken: string }>("/api/v1/auth/step-up", {
        authHash: secret.authHash,
      });
      useAuthStore
        .getState()
        .setTokens(res.accessToken, useAuthStore.getState().refreshToken ?? "");
      onSuccess(res.accessToken);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("stepUp.bioFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Re-derive authHash from password
      const salt = fromBase64(sessionStorage.getItem("vaultctl_salt") ?? "");
      const kdfIter = Number(sessionStorage.getItem("vaultctl_kdf_iter") ?? "3");
      const kdfMem = Number(sessionStorage.getItem("vaultctl_kdf_mem") ?? "65536");
      const kdfPar = Number(sessionStorage.getItem("vaultctl_kdf_par") ?? "4");

      const { authHash } = await deriveKeys(password, salt, {
        iterations: kdfIter,
        memoryKB: kdfMem,
        parallelism: kdfPar,
      });

      const res = await apiPost<{ accessToken: string }>("/api/v1/auth/step-up", {
        authHash: toBase64(authHash),
      });

      // Update the access token in the store
      useAuthStore.getState().setTokens(
        res.accessToken,
        useAuthStore.getState().refreshToken ?? "",
      );

      onSuccess(res.accessToken);
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === "INVALID_CREDENTIALS") {
        setError(t("stepUp.incorrectPassword"));
      } else {
        setError(t("stepUp.verifyFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">{t("stepUp.title")}</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          {t("stepUp.requiresMasterPassword")}
        </p>

        {error && (
          <div className="mb-3 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {bioEnrolled && (
          <div className="mb-4 space-y-2">
            <button
              type="button"
              onClick={handleBiometric}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand hover:bg-brand/15 disabled:opacity-50"
            >
              <Fingerprint className="h-4 w-4" />
              {t("stepUp.confirmWithTouchId")}
            </button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t("stepUp.orMasterPassword")}
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("stepUp.masterPasswordPlaceholder")}
            autoComplete="current-password"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || !password}
              className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t("stepUp.verifying") : t("stepUp.confirm")}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-input px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              {t("common:actions.cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
