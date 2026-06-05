// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MailWarning, Loader2 } from "lucide-react";
import {
  getAccountStatus,
  verifyEmail,
  resendEmailVerification,
  accountStatusQueryKey,
  graceDaysLeft,
} from "@/lib/account-api";

export function VerifyEmailBanner() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: accountStatusQueryKey,
    queryFn: getAccountStatus,
    staleTime: 5 * 60 * 1000,
  });
  const [open, setOpen] = useState(false);

  if (!data || data.emailVerified) return null;

  const daysLeft = graceDaysLeft(data.createdAt);
  const urgent = daysLeft <= 2;

  return (
    <>
      <div
        className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 text-sm ${
          urgent
            ? "border-destructive/40 bg-destructive/10"
            : "border-amber-500/30 bg-amber-500/10"
        }`}
      >
        <MailWarning
          className={`h-4 w-4 shrink-0 ${urgent ? "text-destructive" : "text-amber-600"}`}
        />
        <span className="min-w-0">
          Confirm your email <strong>{data.email}</strong> to keep full access.
          {daysLeft > 0
            ? ` ${daysLeft} day${daysLeft === 1 ? "" : "s"} left before your vault becomes read-only.`
            : " Your vault is read-only until you verify."}
        </span>
        <button
          onClick={() => setOpen(true)}
          className="ml-auto rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Enter code
        </button>
      </div>

      {open && (
        <VerifyEmailDialog
          email={data.email}
          onClose={() => setOpen(false)}
          onVerified={() => {
            queryClient.invalidateQueries({ queryKey: accountStatusQueryKey });
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function VerifyEmailDialog({
  email,
  onClose,
  onVerified,
}: {
  email: string;
  onClose: () => void;
  onVerified: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyEmail(code.trim());
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setResending(true);
    setResent(false);
    try {
      await resendEmailVerification();
      setResent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the code");
    } finally {
      setResending(false);
    }
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 pb-4 pt-[12vh]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        className="animate-scale-in w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="mb-1 text-lg font-semibold">Confirm your email</h2>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          Enter the 6-digit code we sent to {email}.
        </p>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="000000"
          className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
        />

        {error && (
          <div className="mb-3 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
            {error}
          </div>
        )}
        {resent && !error && (
          <div className="mb-3 rounded-lg bg-emerald-500/10 p-2.5 text-xs text-emerald-600">
            A new code is on its way.
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={resend}
            disabled={resending}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          >
            {resending ? "Sending..." : "Resend code"}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-input px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Verify
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
