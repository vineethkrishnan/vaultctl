// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { workerVerifyPassword } from "@/worker/worker-client";
import { ShieldAlert } from "lucide-react";

interface Props {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Reprompt dialog - requires master password re-entry before revealing
 * secrets on items with reprompt=true.
 *
 * Verification runs in the Web Worker: re-derives stretchedKey from the
 * entered password and compares to the stored one. No network call needed.
 */
export function RepromptDialog({ open, onConfirm, onCancel }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // KDF params are stored in sessionStorage during login
  const salt = sessionStorage.getItem("vaultctl_salt") ?? "";
  const kdfIterations = Number(sessionStorage.getItem("vaultctl_kdf_iter") ?? "3");
  const kdfMemoryKB = Number(sessionStorage.getItem("vaultctl_kdf_mem") ?? "65536");
  const kdfParallelism = Number(sessionStorage.getItem("vaultctl_kdf_par") ?? "4");

  useEffect(() => {
    if (open) {
      setPassword("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setVerifying(true);

    try {
      const valid = await workerVerifyPassword({
        password,
        salt,
        kdfIterations,
        kdfMemoryKB,
        kdfParallelism,
      });

      if (valid) {
        onConfirm();
      } else {
        setError(t("vault:reprompt.incorrect"));
      }
    } catch {
      setError(t("vault:reprompt.verifyFailed"));
    } finally {
      setVerifying(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-yellow-500" />
          <h2 className="text-lg font-semibold">{t("vault:reprompt.title")}</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          {t("vault:reprompt.subtitle")}
        </p>

        {error && (
          <div className="mb-3 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleVerify} className="space-y-4">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("vault:reprompt.passwordPlaceholder")}
            autoComplete="current-password"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={verifying || !password}
              className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {verifying ? t("vault:reprompt.verifying") : t("common:actions.confirm")}
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
