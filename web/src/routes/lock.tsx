import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuthStore } from "@/lib/auth-store";

export function LockPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [password, setPassword] = useState("");

  function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    // For v1 MVP, lock → re-login. Phase 3 Worker will support true unlock
    // by caching encrypted blobs and re-deriving keys without a round-trip.
    logout();
    navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Vault Locked</h1>
          <p className="text-sm text-muted-foreground">
            Your vault has been locked. Enter your master password to unlock.
          </p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="lock-password" className="text-sm font-medium">
              Master Password
            </label>
            <input
              id="lock-password"
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
            disabled={!password}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Unlock
          </button>
        </form>

        <button
          onClick={() => {
            logout();
            navigate({ to: "/login" });
          }}
          className="w-full text-sm text-muted-foreground hover:text-foreground"
        >
          Log out instead
        </button>
      </div>
    </div>
  );
}
