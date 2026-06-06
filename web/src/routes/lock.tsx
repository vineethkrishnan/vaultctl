// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";

export function LockPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  // True in-place unlock (re-deriving keys from a cached blob) is a separate
  // effort. Until then, locking ends the session and the only way back in is to
  // sign in again - so the screen says exactly that instead of a fake field.
  function signInAgain() {
    logout();
    navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-6 text-center">
        <div className="space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">{t("lock.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("lock.sessionLocked")}</p>
        </div>

        <button
          type="button"
          onClick={signInAgain}
          autoFocus
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("lock.signInAgain")}
        </button>
      </div>
    </div>
  );
}
