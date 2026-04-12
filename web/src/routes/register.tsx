import { useState } from "react";
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
  toBase64,
  zero,
} from "@/shared/crypto";
import type { RegisterResponse } from "@/shared/types/api";
import { RecoveryKitDownload } from "@/components/auth/RecoveryKitDownload";

type Step = "form" | "processing" | "recovery" | "done";

export function RegisterPage() {
  const navigate = useNavigate();
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
      setError("Passwords do not match");
      return;
    }
    if (password.length < 10) {
      setError("Password must be at least 10 characters");
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
      // At registration time we don't have IDs yet — server will assign them.
      // We use placeholder bytes; the server-side can re-verify after ID assignment.
      // For v1, the wrap signature at registration uses the serialized encVaultKey blob.
      const encVaultKeyBytes = serializeBlob(encVaultKey);
      const wrapSigData = encVaultKeyBytes; // Simplified for self-wrap at registration
      const wrapSig = await ed25519Sign(idPrivKey, wrapSigData);

      // Generate recovery kit
      const { recoveryKey } = await generateRecoveryKit(rsaKp.privateKey);
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
        publicKey: toBase64(rsaKp.publicKey),
        publicKeySignature: toBase64(pubKeySig),
        identityPublicKey: toBase64(ed25519Kp.publicKey),
      });

      // Create personal vault
      await apiPost("/api/v1/vaults", {
        name: "Personal Vault",
        type: "personal",
        encryptedVaultKey: toBase64(encVaultKeyBytes),
        wrapSignature: toBase64(wrapSig),
      });

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
          setError("An account with this email already exists");
        } else if (err.error.code === "WEAK_MASTER_PASSWORD") {
          setError("Password is too weak — try a longer passphrase");
        } else {
          setError(err.error.message);
        }
      } else {
        setError("Registration failed — check your connection");
      }
    }
  }

  if (step === "processing") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-4 text-center">
          <div className="text-lg font-medium">Creating your account...</div>
          <p className="text-sm text-muted-foreground">
            Generating encryption keys. This may take a few seconds.
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
            <h1 className="text-2xl font-bold">Recovery Kit</h1>
            <p className="text-sm text-muted-foreground">
              Save this recovery key somewhere safe. It&apos;s the only way to
              recover your vault if you forget your master password. This will
              not be shown again.
            </p>
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
              I have safely stored my recovery key
            </label>
          </div>

          <button
            onClick={() => navigate({ to: "/login" })}
            disabled={!recoveryConfirmed}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Continue to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Create Account</h1>
          <p className="text-sm text-muted-foreground">
            Set up your zero-knowledge vault
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="reg-email" className="text-sm font-medium">
              Email
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
              Name
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
              Master Password
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
              Confirm Password
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
            Create Account
          </button>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-primary underline">
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
