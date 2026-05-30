// SPDX-License-Identifier: AGPL-3.0-or-later

import { Outlet, useRouterState } from "@tanstack/react-router";
import { VaultSidebar } from "@/components/vault/VaultSidebar";
import { useAutoLock } from "@/hooks/use-auto-lock";
import { useCryptoWorker } from "@/hooks/use-crypto-worker";

export function AuthLayout() {
  // Wire Worker locked event → auth store
  useCryptoWorker();
  // Auto-lock on inactivity (15 min default)
  useAutoLock();

  // Re-key the content on navigation so each view eases in.
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="app-backdrop flex h-screen overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <VaultSidebar />
      <main id="main-content" className="flex-1 overflow-y-auto p-6 md:p-8" role="main">
        <div key={pathname} className="animate-fade-up">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
