// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect } from "react";
import { Fingerprint, Check } from "lucide-react";
import { apiGet, apiPost, ApiRequestError } from "@/lib/api-client";
import { deriveKeys, fromBase64, toBase64 } from "@/shared/crypto";
import type { PreloginResponse } from "@/shared/types/api";
import {
  isBiometricAvailable,
  isBiometricEnrolled,
  enrollBiometric,
  clearBiometric,
} from "@/lib/biometric";

/**
 * Enroll / disable Touch ID (WebAuthn PRF) unlock for the web app. Enrolling
 * re-verifies the master password (so a wrong one is never sealed), then seals
 * the unlock material behind the platform authenticator.
 */
export function BiometricSetting() {
  const [available, setAvailable] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setAvailable(await isBiometricAvailable());
      setEnrolled(isBiometricEnrolled());
    })();
  }, []);

  async function enable() {
    setError(null);
    const email = sessionStorage.getItem("vaultctl_email") ?? "";
    if (!email) {
      setError("Sign in again before enabling Touch ID");
      return;
    }
    if (!password) {
      setError("Enter your master password");
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
      if (err instanceof ApiRequestError && err.error.code === "INVALID_CREDENTIALS") {
        setError("Incorrect master password");
      } else {
        setError(err instanceof Error ? err.message : "Could not enable Touch ID");
      }
    } finally {
      setBusy(false);
    }
  }

  function disable() {
    clearBiometric();
    setEnrolled(false);
  }

  if (!available) return null;

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Fingerprint className="h-3.5 w-3.5 text-brand" />
            Unlock with Touch ID
            {enrolled && (
              <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-500">
                <Check className="h-3 w-3" /> Enabled
              </span>
            )}
          </span>
          <span className="block text-xs text-muted-foreground">
            {enrolled
              ? "Used for unlock and identity confirmation on this device."
              : "Skip the master password on this device after one verification."}
          </span>
        </span>
        {enrolled ? (
          <button
            onClick={disable}
            className="shrink-0 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Disable
          </button>
        ) : (
          <button
            onClick={() => setEnrolling((v) => !v)}
            className="shrink-0 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            {enrolling ? "Cancel" : "Enable"}
          </button>
        )}
      </div>

      {enrolling && !enrolled && (
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
            onClick={enable}
            disabled={busy}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Registering…" : "Confirm and register Touch ID"}
          </button>
        </div>
      )}
      {error && !enrolling && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>
      )}
    </div>
  );
}
