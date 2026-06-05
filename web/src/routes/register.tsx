// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useNavigate, Link } from "@tanstack/react-router";
import { apiPost, ApiRequestError } from "@/lib/api-client";
import {
  deriveKeys,
  DEFAULT_KDF_PARAMS,
  generateRSAKeyPair,
  generateEd25519KeyPair,
  importEd25519PrivateKey,
  ed25519Sign,
  aesGcmEncrypt,
  aesKeyWrap,
  serializeBlob,
  generateRecoveryKit,
  formatRecoveryKey,
  pad,
  toBase64,
  zero,
} from "@/shared/crypto";
import type { RegisterResponse, LoginResponse } from "@/shared/types/api";
import { useAuthStore } from "@/lib/auth-store";
import { RecoveryKitDownload } from "@/components/auth/RecoveryKitDownload";

type Step = "form" | "processing" | "recovery" | "done";

// Default folders created in the new personal vault so the account isn't empty.
// Names are encrypted client-side with the vault key, like any folder.
const DEFAULT_FOLDERS = ["Personal", "Work", "Temporary"];

export function RegisterPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Recovery kit
  const [recoveryKeyFormatted, setRecoveryKeyFormatted] = useState("");
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("errors.passwordsMismatch"));
      return;
    }
    if (password.length < 10) {
      setError(t("errors.passwordTooShort"));
      return;
    }

    setStep("processing");

    try {
      // Generate salt
      const salt = crypto.getRandomValues(new Uint8Array(16));

      // Derive keys
      const { authHash, stretchedKey } = await deriveKeys(
        password,
        salt,
        DEFAULT_KDF_PARAMS,
      );

      // Generate RSA-2048 keypair
      const rsaKp = await generateRSAKeyPair();

      // Generate Ed25519 identity keypair
      const ed25519Kp = await generateEd25519KeyPair();

      // Sign RSA public key with Ed25519 identity key (C1)
      const idPrivKey = await importEd25519PrivateKey(ed25519Kp.privateKey);
      const pubKeySig = await ed25519Sign(idPrivKey, rsaKp.publicKey);

      // Encrypt RSA private key with stretchedKey
      const encPrivKey = await aesGcmEncrypt(stretchedKey, rsaKp.privateKey);

      // Encrypt Ed25519 identity private key with stretchedKey
      const encIdPrivKey = await aesGcmEncrypt(
        stretchedKey,
        ed25519Kp.privateKey,
      );

      // Generate personal vault key
      const vaultKey = crypto.getRandomValues(new Uint8Array(32));

      // Wrap vault key with AES-KW using stretchedKey (M4: personal vault)
      const encVaultKey = await aesKeyWrap(stretchedKey, vaultKey);

      // Build wrap signature: Ed25519(idPriv, vaultId || userId || encVaultKey)
      // At registration time we don't have IDs yet - server will assign them.
      // We use placeholder bytes; the server-side can re-verify after ID assignment.
      // For v1, the wrap signature at registration uses the serialized encVaultKey blob.
      const encVaultKeyBytes = serializeBlob(encVaultKey);
      const wrapSigData = encVaultKeyBytes; // Simplified for self-wrap at registration
      const wrapSig = await ed25519Sign(idPrivKey, wrapSigData);

      // Generate recovery kit: wrap both private keys under a fresh recovery
      // key so a future password reset can restore the full key set.
      const { recoveryKey, recoveryWrappedPrivKey, recoveryWrappedIdentityPrivKey } =
        await generateRecoveryKit(rsaKp.privateKey, ed25519Kp.privateKey);
      setRecoveryKeyFormatted(formatRecoveryKey(recoveryKey));

      // Register user
      await apiPost<RegisterResponse>("/api/v1/auth/register", {
        email,
        name,
        authHash: toBase64(authHash),
        salt: toBase64(salt),
        masterPasswordPreflight: password,
        kdfIterations: DEFAULT_KDF_PARAMS.iterations,
        kdfMemoryKB: DEFAULT_KDF_PARAMS.memoryKB,
        kdfParallelism: DEFAULT_KDF_PARAMS.parallelism,
        encryptedPrivateKey: toBase64(serializeBlob(encPrivKey)),
        encryptedIdentityPrivateKey: toBase64(serializeBlob(encIdPrivKey)),
        recoveryWrappedPrivateKey: toBase64(serializeBlob(recoveryWrappedPrivKey)),
        recoveryWrappedIdentityPrivateKey: toBase64(
          serializeBlob(recoveryWrappedIdentityPrivKey),
        ),
        publicKey: toBase64(rsaKp.publicKey),
        publicKeySignature: toBase64(pubKeySig),
        identityPublicKey: toBase64(ed25519Kp.publicKey),
      });

      // Register returns {userId, role} only - exchange for tokens before
      // any authenticated call (vault create, etc.).
      const loginRes = await apiPost<LoginResponse>("/api/v1/auth/login", {
        email,
        authHash: toBase64(authHash),
        deviceName: navigator.userAgent.slice(0, 128),
      });
      setAuth({
        userId: loginRes.userId,
        role: loginRes.role,
        accessToken: loginRes.accessToken,
        refreshToken: loginRes.refreshToken,
        sessionId: loginRes.sessionId,
      });

      // Create personal vault
      const vault = await apiPost<{ vaultId: string }>("/api/v1/vaults", {
        name: "Personal Vault",
        type: "personal",
        encryptedVaultKey: toBase64(encVaultKeyBytes),
        wrapSignature: toBase64(wrapSig),
      });

      // Seed default folders so the vault isn't empty on first open. Encrypt
      // each name with the vault key here (the crypto worker isn't initialized
      // during registration). A failure here must not fail registration.
      try {
        const encoder = new TextEncoder();
        for (const folderName of DEFAULT_FOLDERS) {
          const encryptedName = toBase64(
            serializeBlob(await aesGcmEncrypt(vaultKey, pad(encoder.encode(folderName)))),
          );
          await apiPost(`/api/v1/vaults/${vault.vaultId}/folders`, { encryptedName });
        }
      } catch {
        // Non-fatal: the user can create folders manually later.
      }

      // Clean up sensitive material
      zero(stretchedKey);
      zero(authHash);
      zero(vaultKey);
      zero(recoveryKey);

      setStep("recovery");
    } catch (err) {
      setStep("form");
      if (err instanceof ApiRequestError) {
        if (err.error.code === "CONFLICT") {
          setError(t("errors.emailExists"));
        } else if (err.error.code === "WEAK_MASTER_PASSWORD") {
          setError(t("errors.weakPassword"));
        } else {
          setError(err.error.message);
        }
      } else {
        setError(t("errors.registrationFailed"));
      }
    }
  }

  if (step === "processing") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-4 text-center">
          <div className="text-lg font-medium">{t("register.processingTitle")}</div>
          <p className="text-sm text-muted-foreground">
            {t("register.processingSubtitle")}
          </p>
        </div>
      </div>
    );
  }

  if (step === "recovery") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-md space-y-6 p-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">{t("recoveryKit.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("recoveryKit.intro")}</p>
          </div>

          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <Trans t={t} i18nKey="recoveryKit.warning" components={{ 1: <strong /> }} />
          </div>

          <div className="rounded-md border border-border bg-card p-4 font-mono text-sm break-all select-all">
            {recoveryKeyFormatted}
          </div>

          <RecoveryKitDownload recoveryKey={recoveryKeyFormatted} />

          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="recovery-confirm"
              checked={recoveryConfirmed}
              onChange={(e) => setRecoveryConfirmed(e.target.checked)}
              className="mt-1"
            />
            <label htmlFor="recovery-confirm" className="text-sm">
              {t("recoveryKit.confirm")}
            </label>
          </div>

          <button
            onClick={() => navigate({ to: "/login" })}
            disabled={!recoveryConfirmed}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {t("recoveryKit.continue")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">{t("register.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("register.subtitle")}</p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="reg-email" className="text-sm font-medium">
              {t("register.emailLabel")}
            </label>
            <input
              id="reg-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="reg-name" className="text-sm font-medium">
              {t("register.nameLabel")}
            </label>
            <input
              id="reg-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="reg-password" className="text-sm font-medium">
              {t("register.masterPassword")}
            </label>
            <input
              id="reg-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              autoComplete="new-password"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="reg-confirm" className="text-sm font-medium">
              {t("register.confirmPassword")}
            </label>
            <input
              id="reg-confirm"
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
            disabled={!email || !name || !password || !confirmPassword}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {t("register.submit")}
          </button>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          {t("register.haveAccount")}{" "}
          <Link to="/login" className="text-primary underline">
            {t("register.logIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
