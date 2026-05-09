// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { workerLock } from "@/worker/worker-client";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Auto-lock the vault after inactivity. Listens for user activity events
 * and resets the timer on each one. On timeout, locks via the Worker.
 */
export function useAutoLock(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const lockStore = useAuthStore((s) => s.lock);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!isAuthenticated) return;

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
