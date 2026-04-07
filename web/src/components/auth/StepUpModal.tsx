import { useState, useRef, useEffect } from "react";
import { apiPost, ApiRequestError } from "@/lib/api-client";
import { deriveKeys, fromBase64, toBase64 } from "@/shared/crypto";
import { useAuthStore } from "@/lib/auth-store";
import { ShieldCheck } from "lucide-react";

interface Props {
  open: boolean;
  onSuccess: (newAccessToken: string) => void;
  onCancel: () => void;
}

/**
 * Step-up modal — re-verifies master password and obtains a fresh JWT
 * with step-up claim. Called when an API returns 403 STEP_UP_REQUIRED.
 */
export function StepUpModal({ open, onSuccess, onCancel }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

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
        setError("Incorrect password");
      } else {
        setError("Verification failed");
      }
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Confirm Identity</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          This action requires your master password.
        </p>

        {error && (
          <div className="mb-3 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Master password"
            autoComplete="current-password"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || !password}
              className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Confirm"}
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
    </div>
  );
}
