// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useNavigate, Link } from "@tanstack/react-router";
import { useAuthStore } from "@/lib/auth-store";
import { apiGet, apiPost, ApiRequestError } from "@/lib/api-client";
import { initKeys } from "@/lib/key-holder";
import { deriveKeys, fromBase64, toBase64 } from "@/shared/crypto";
import type { PreloginResponse, LoginResponse } from "@/shared/types/api";
import { BrandMark } from "@/components/BrandMark";
import { deviceLabel } from "@/lib/device";
import {
  isBiometricAvailable,
  isBiometricEnrolled,
  getBiometricRecord,
  unlockWithBiometric,
  clearBiometric,
  type BiometricKDF,
} from "@/lib/biometric";
import { Fingerprint, Loader2 } from "lucide-react";

export function LoginPage() {
  const { t } = useTranslation(["auth", "common"]);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"email" | "password">("email");
  // When an email is remembered we skip straight to the password step, but
  // prelogin is async - render a spinner until it resolves rather than flashing
  // the email form first. Seeded synchronously so the email form never paints.
  const [booting, setBooting] = useState(
    () => localStorage.getItem("vaultctl_remember_email") !== null,
  );

  // Prelogin state
  const [kdfParams, setKdfParams] = useState<PreloginResponse | null>(null);
  const [remember, setRemember] = useState(false);

  // Biometric (Touch ID) unlock state
  const [bioEnrolled, setBioEnrolled] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if ((await isBiometricAvailable()) && isBiometricEnrolled()) {
        setBioEnrolled(true);
        const rec = getBiometricRecord();
        if (rec?.email) setEmail((prev) => prev || rec.email);
      }
    })();
  }, []);

  // If an email was remembered on this device, prefill it and skip straight
  // to the master-password step so unlocking only needs the password.
  useEffect(() => {
    const saved = localStorage.getItem("vaultctl_remember_email");
    if (!saved) return;
    setEmail(saved);
    setRemember(true);
    void (async () => {
      setLoading(true);
      try {
        const params = await apiGet<PreloginResponse>(
          `/api/v1/auth/prelogin?email=${encodeURIComponent(saved)}`,
        );
        setKdfParams(params);
        setStep("password");
      } catch {
        // Prelogin failed (offline or unknown email) - stay on the email step.
      } finally {
        setLoading(false);
        setBooting(false);
      }
    })();
  }, []);

  async function handlePrelogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const params = await apiGet<PreloginResponse>(
        `/api/v1/auth/prelogin?email=${encodeURIComponent(email)}`,
      );
      setKdfParams(params);
      if (remember) localStorage.setItem("vaultctl_remember_email", email);
      else localStorage.removeItem("vaultctl_remember_email");
      setStep("password");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.error.message);
      } else {
        setError(t("errors.connectionFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  // Shared tail for every unlock path (master password or Touch ID): store
  // tokens + KDF state, hand keys to the worker, then enter the vault.
  async function completeUnlock(
    res: LoginResponse,
    stretchedKey: Uint8Array,
    accountEmail: string,
    kdf: BiometricKDF,
  ) {
    setAuth({
      userId: res.userId,
      role: res.role,
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      sessionId: res.sessionId,
    });
    sessionStorage.setItem("vaultctl_email", accountEmail);
    sessionStorage.setItem("vaultctl_salt", kdf.salt);
    sessionStorage.setItem("vaultctl_kdf_iter", String(kdf.iterations));
    sessionStorage.setItem("vaultctl_kdf_mem", String(kdf.memoryKB));
    sessionStorage.setItem("vaultctl_kdf_par", String(kdf.parallelism));
    sessionStorage.setItem("vaultctl_id_pubkey", res.identityPublicKey);
    sessionStorage.setItem("vaultctl_login_enc_priv", res.encryptedPrivateKey);
    sessionStorage.setItem(
      "vaultctl_login_enc_id_priv",
      res.encryptedIdentityPrivateKey,
    );

    await initKeys({
      stretchedKey,
      encryptedPrivateKey: res.encryptedPrivateKey,
      encryptedIdentityPrivateKey: res.encryptedIdentityPrivateKey,
      publicKey: res.publicKey,
      vaults: res.vaults,
    });

    const firstVault = res.vaults[0];
    navigate({
      to: "/vault/$vaultId",
      params: { vaultId: firstVault ? firstVault.vaultId : "none" },
    });
  }

  async function handleBiometricUnlock() {
    setError(null);
    setBioBusy(true);
    try {
      const { secret, kdf } = await unlockWithBiometric();
      const res = await apiPost<LoginResponse>("/api/v1/auth/login", {
        email: secret.email,
        authHash: secret.authHash,
        deviceName: await deviceLabel(),
      });
      await completeUnlock(res, fromBase64(secret.stretchedKey), secret.email, kdf);
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === "INVALID_CREDENTIALS") {
        // Stored authHash no longer valid (master password changed elsewhere).
        clearBiometric();
        setBioEnrolled(false);
        setError(t("errors.bioMasterChanged"));
      } else {
        setError(err instanceof Error ? err.message : t("errors.bioFailed"));
      }
    } finally {
      setBioBusy(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!kdfParams) return;
    setError(null);
    setLoading(true);

    try {
      // Derive keys from master password
      const salt = fromBase64(kdfParams.salt);
      const { authHash, stretchedKey } = await deriveKeys(password, salt, {
        iterations: kdfParams.iterations,
        memoryKB: kdfParams.memoryKB,
        parallelism: kdfParams.parallelism,
      });

      // Login
      const res = await apiPost<LoginResponse>("/api/v1/auth/login", {
        email,
        authHash: toBase64(authHash),
        deviceName: await deviceLabel(),
      });

      await completeUnlock(res, stretchedKey, email, {
        salt: kdfParams.salt,
        iterations: kdfParams.iterations,
        memoryKB: kdfParams.memoryKB,
        parallelism: kdfParams.parallelism,
      });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.error.code === "INVALID_CREDENTIALS") {
          setError(t("errors.invalidCredentials"));
        } else if (err.error.code === "ACCOUNT_LOCKED") {
          setError(t("errors.accountLocked"));
        } else {
          setError(err.error.message);
        }
      } else {
        setError(t("errors.loginFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="flex flex-col items-center space-y-3 text-center">
          <h1 className="sr-only">VaultCTL</h1>
          <div className="flex flex-col items-center gap-0.5">
            <BrandMark className="text-8xl text-brand" />
            <BrandMark variant="wordmark" className="block text-3xl" />
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("tagline")}
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {booting ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
        {bioEnrolled && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleBiometricUnlock}
              disabled={bioBusy}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand hover:bg-brand/15 disabled:opacity-50"
            >
              <Fingerprint className="h-4 w-4" />
              {bioBusy ? t("biometric.unlocking") : t("biometric.unlock")}
            </button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t("biometric.orPassword")}
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}

        {step === "email" ? (
          <form onSubmit={handlePrelogin} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                {t("login.emailLabel")}
              </label>
              <input
                id="email"
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
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="accent-brand"
              />
              {t("login.rememberMe")}
            </label>
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t("common:loading") : t("common:actions.continue")}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <Trans
                t={t}
                i18nKey="login.loggingInAs"
                values={{ email }}
                components={{ 1: <strong /> }}
              />{" "}
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setRemember(false);
                  localStorage.removeItem("vaultctl_remember_email");
                }}
                className="text-primary underline"
              >
                {t("login.change")}
              </button>
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                {t("login.masterPassword")}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="current-password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t("login.derivingKeys") : t("login.unlock")}
            </button>
            <div className="text-center text-sm">
              <Link to="/recovery" className="text-muted-foreground underline">
                {t("login.forgotPassword")}
              </Link>
            </div>
          </form>
        )}
          </>
        )}

        <div className="text-center text-sm text-muted-foreground">
          {t("login.noAccount")}{" "}
          <Link to="/register" className="text-primary underline">
            {t("login.createOne")}
          </Link>
        </div>
      </div>
    </div>
  );
}
