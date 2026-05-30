// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { apiPost, ApiRequestError } from "@/lib/api-client";
import { Shield, Check } from "lucide-react";
import { QRCode } from "@/components/ui/QRCode";

interface SetupResponse {
  secret: string;
  otpauthUrl: string;
}

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

type Step = "setup" | "verify";

/**
 * TOTP setup flow:
 * 1. POST /auth/totp/setup → get secret + QR URL
 * 2. User scans QR or enters secret manually
 * 3. User enters 6-digit code
 * 4. POST /auth/totp/enable → verify code + enable
 */
export function TOTPSetup({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>("setup");
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSetup() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiPost<SetupResponse>("/api/v1/auth/totp/setup");
      setSecret(res.secret);
      setOtpauthUrl(res.otpauthUrl);
      setStep("verify");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.error.message);
      } else {
        setError("Failed to setup TOTP");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiPost("/api/v1/auth/totp/enable", { code });
      onComplete();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.error.code === "INVALID_CREDENTIALS") {
          setError("Invalid code — check your authenticator app");
        } else {
          setError(err.error.message);
        }
      } else {
        setError("Verification failed");
      }
    } finally {
      setLoading(false);
    }
  }

  if (step === "setup") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Enable Two-Factor Authentication</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Add an extra layer of security. You&apos;ll need an authenticator app like
          Google Authenticator or Authy.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleSetup}
            disabled={loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Setting up..." : "Begin Setup"}
          </button>
          <button
            onClick={onCancel}
            className="rounded-md border border-input px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
        {error && (
          <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Scan QR Code</h2>
      <p className="text-sm text-muted-foreground">
        Scan this QR code with your authenticator app, or enter the secret key manually.
      </p>

      {/* Scannable QR of the otpauth:// URL */}
      {otpauthUrl && (
        <div className="flex justify-center rounded-md border border-border bg-white p-4">
          <QRCode value={otpauthUrl} size={200} level="M" />
        </div>
      )}

      <div className="space-y-1">
        <label className="text-sm font-medium">Manual entry key</label>
        <code className="block rounded bg-muted px-3 py-2 font-mono text-sm tracking-wider select-all">
          {secret}
        </code>
      </div>

      <form onSubmit={handleVerify} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="totp-code" className="text-sm font-medium">
            Verification code
          </label>
          <input
            id="totp-code"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            autoFocus
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono tracking-widest outline-none ring-ring focus:ring-2"
          />
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Check className="mr-1 inline h-4 w-4" />
            {loading ? "Verifying..." : "Enable 2FA"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-input px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
