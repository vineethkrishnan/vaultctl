// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useAuthStore } from "@/lib/auth-store";
import { apiGet, apiPost, ApiRequestError } from "@/lib/api-client";
import { initKeys } from "@/lib/key-holder";
import { deriveKeys, fromBase64, toBase64 } from "@/shared/crypto";
import type { PreloginResponse, LoginResponse } from "@/shared/types/api";
import { BrandMark } from "@/components/BrandMark";
import { deviceLabel } from "@/lib/device";

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"email" | "password">("email");

  // Prelogin state
  const [kdfParams, setKdfParams] = useState<PreloginResponse | null>(null);
  const [remember, setRemember] = useState(false);

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
        setError("Connection failed");
      }
    } finally {
      setLoading(false);
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

      // Store auth tokens
      setAuth({
        userId: res.userId,
        role: res.role,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        sessionId: res.sessionId,
      });

      // Cache KDF params + salt for reprompt verification and lock/unlock
      sessionStorage.setItem("vaultctl_email", email);
      sessionStorage.setItem("vaultctl_salt", kdfParams.salt);
      sessionStorage.setItem("vaultctl_kdf_iter", String(kdfParams.iterations));
      sessionStorage.setItem("vaultctl_kdf_mem", String(kdfParams.memoryKB));
      sessionStorage.setItem("vaultctl_kdf_par", String(kdfParams.parallelism));
      sessionStorage.setItem("vaultctl_id_pubkey", res.identityPublicKey);

      // Initialize key custody
      await initKeys({
        stretchedKey,
        encryptedPrivateKey: res.encryptedPrivateKey,
        encryptedIdentityPrivateKey: res.encryptedIdentityPrivateKey,
        vaults: res.vaults,
      });

      // Navigate to first vault
      const firstVault = res.vaults[0];
      if (firstVault) {
        navigate({ to: "/vault/$vaultId", params: { vaultId: firstVault.vaultId } });
      } else {
        // No vaults yet — user needs to create one
        navigate({ to: "/vault/$vaultId", params: { vaultId: "none" } });
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.error.code === "INVALID_CREDENTIALS") {
          setError("Invalid email or password");
        } else if (err.error.code === "ACCOUNT_LOCKED") {
          setError("Account locked due to too many failed attempts");
        } else {
          setError(err.error.message);
        }
      } else {
        setError("Login failed — check your connection");
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
          <BrandMark className="text-7xl text-brand" />
          <BrandMark variant="wordmark" className="block text-4xl" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            A zero-knowledge, self-hosted password vault.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {step === "email" ? (
          <form onSubmit={handlePrelogin} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
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
              Remember me on this device
            </label>
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Continue"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Logging in as <strong>{email}</strong>{" "}
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setRemember(false);
                  localStorage.removeItem("vaultctl_remember_email");
                }}
                className="text-primary underline"
              >
                change
              </button>
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Master Password
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
              {loading ? "Deriving keys..." : "Unlock"}
            </button>
          </form>
        )}

        <div className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link to="/register" className="text-primary underline">
            Create one
          </Link>
        </div>
      </div>
    </div>
  );
}
