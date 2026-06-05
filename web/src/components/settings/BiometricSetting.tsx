// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Fingerprint, Check } from "lucide-react";
import { apiGet, apiPost, ApiRequestError } from "@/lib/api-client";
import { deriveKeys, fromBase64, toBase64 } from "@/shared/crypto";
import type { PreloginResponse } from "@/shared/types/api";
import {
  isBiometricAvailable,
  isBiometricEnrolled,
  isBiometricUnsupported,
  markBiometricUnsupported,
  enrollBiometric,
  clearBiometric,
  BiometricPrfUnsupportedError,
} from "@/lib/biometric";

/**
 * Enroll / disable Touch ID (WebAuthn PRF) unlock for the web app. Enrolling
 * re-verifies the master password (so a wrong one is never sealed), then seals
 * the unlock material behind the platform authenticator.
 */
export function BiometricSetting() {
  const { t } = useTranslation(["settings", "common"]);
  const [available, setAvailable] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setAvailable(await isBiometricAvailable());
      setEnrolled(isBiometricEnrolled());
      setUnsupported(isBiometricUnsupported());
    })();
  }, []);

  async function enable() {
    setError(null);
    const email = sessionStorage.getItem("vaultctl_email") ?? "";
    if (!email) {
      setError(t("biometric.signInAgain"));
      return;
    }
    if (!password) {
      setError(t("biometric.enterMasterPassword"));
      return;
    }
    setBusy(true);
    try {
      const params = await apiGet<PreloginResponse>(
        `/api/v1/auth/prelogin?email=${encodeURIComponent(email)}`,
      );
      const { authHash, stretchedKey } = await deriveKeys(password, fromBase64(params.salt), {
        iterations: params.iterations,
        memoryKB: params.memoryKB,
        parallelism: params.parallelism,
      });
      // Verify the password is correct before sealing it (also refreshes the
      // step-up claim as a harmless side effect).
      await apiPost("/api/v1/auth/step-up", { authHash: toBase64(authHash) });
      await enrollBiometric(
        { email, authHash: toBase64(authHash), stretchedKey: toBase64(stretchedKey) },
        {
          salt: params.salt,
          iterations: params.iterations,
          memoryKB: params.memoryKB,
          parallelism: params.parallelism,
        },
      );
      setPassword("");
      setEnrolling(false);
      setEnrolled(true);
    } catch (err) {
      if (err instanceof BiometricPrfUnsupportedError) {
        markBiometricUnsupported();
        setUnsupported(true);
        setEnrolling(false);
        setPassword("");
        setError(null);
      } else if (err instanceof ApiRequestError && err.error.code === "INVALID_CREDENTIALS") {
        setError(t("biometric.incorrectPassword"));
      } else {
        setError(err instanceof Error ? err.message : t("biometric.enableFailed"));
      }
    } finally {
      setBusy(false);
    }
  }

  function disable() {
    clearBiometric();
    setEnrolled(false);
  }

  if (!available && !unsupported) return null;

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Fingerprint className="h-3.5 w-3.5 text-brand" />
            {t("biometric.title")}
            {enrolled && (
              <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-500">
                <Check className="h-3 w-3" /> {t("biometric.enabled")}
              </span>
            )}
          </span>
          <span className="block text-xs text-muted-foreground">
            {enrolled
              ? t("biometric.descriptionEnrolled")
              : unsupported
                ? t("biometric.descriptionUnsupported")
                : t("biometric.descriptionAvailable")}
          </span>
        </span>
        {enrolled ? (
          <button
            onClick={disable}
            className="shrink-0 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            {t("biometric.disable")}
          </button>
        ) : unsupported ? (
          <span className="shrink-0 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground/60">
            {t("biometric.notAvailable")}
          </span>
        ) : (
          <button
            onClick={() => setEnrolling((v) => !v)}
            className="shrink-0 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            {enrolling ? t("common:actions.cancel") : t("biometric.enable")}
          </button>
        )}
      </div>

      {enrolling && !enrolled && !unsupported && (
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
            placeholder={t("biometric.masterPasswordPlaceholder")}
            autoComplete="current-password"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
          <button
            onClick={enable}
            disabled={busy}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? t("biometric.registering") : t("biometric.confirmAndRegister")}
          </button>
        </div>
      )}
      {error && !enrolling && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>
      )}
    </div>
  );
}
