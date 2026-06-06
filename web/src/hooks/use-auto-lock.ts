// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { workerLock } from "@/worker/worker-client";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export const LOCK_TIMEOUT_STORAGE_KEY = "vaultctl_lock_timeout";
// Fired by the settings screen so an open session picks up a new timeout
// without waiting for a cross-tab `storage` event (which never fires same-tab).
export const LOCK_TIMEOUT_CHANGED_EVENT = "vaultctl:lock-timeout-changed";

function readStoredTimeout(): number {
  const stored = localStorage.getItem(LOCK_TIMEOUT_STORAGE_KEY);
  if (stored === null) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? parsed : DEFAULT_TIMEOUT_MS;
}

/**
 * Auto-lock the vault after inactivity. Reads the user's configured timeout
 * from localStorage (0 = "Never" = disabled), reacts to changes, listens for
 * user activity, and resets the timer on each event. On timeout, locks via the
 * Worker.
 */
export function useAutoLock(overrideTimeoutMs?: number) {
  const lockStore = useAuthStore((s) => s.lock);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [storedTimeoutMs, setStoredTimeoutMs] = useState(readStoredTimeout);

  useEffect(() => {
    if (overrideTimeoutMs !== undefined) return;
    function refresh() {
      setStoredTimeoutMs(readStoredTimeout());
    }
    window.addEventListener("storage", refresh);
    window.addEventListener(LOCK_TIMEOUT_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(LOCK_TIMEOUT_CHANGED_EVENT, refresh);
    };
  }, [overrideTimeoutMs]);

  const timeoutMs = overrideTimeoutMs ?? storedTimeoutMs;

  useEffect(() => {
    if (!isAuthenticated) return;
    // 0 (or any non-positive value) means "Never" - auto-lock is disabled.
    if (timeoutMs <= 0) return;

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        workerLock();
        lockStore();
      }, timeoutMs);
    }

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((ev) => document.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      events.forEach((ev) => document.removeEventListener(ev, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isAuthenticated, lockStore, timeoutMs]);
}
