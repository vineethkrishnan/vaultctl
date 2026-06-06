// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { VaultSidebar } from "@/components/vault/VaultSidebar";
import { UpdateBanner } from "@/components/system/UpdateBanner";
import { VerifyEmailBanner } from "@/components/system/VerifyEmailBanner";
import { QuickActions } from "@/components/layout/QuickActions";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { useAutoLock } from "@/hooks/use-auto-lock";
import { useCryptoWorker } from "@/hooks/use-crypto-worker";
import { useServerFeatures } from "@/hooks/use-server-features";

export function AuthLayout() {
  const { t } = useTranslation("common");
  const features = useServerFeatures();
  // Wire Worker locked event → auth store
  useCryptoWorker();
  // Auto-lock on inactivity (timeout read from the user's settings).
  useAutoLock();

  // Re-key the content on navigation so each view eases in.
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <div className="app-backdrop flex h-screen overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        {t("chrome.skipToContent")}
      </a>

      {/* Mobile drawer backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <VaultSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex items-center gap-2 border-b border-border px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label={t("chrome.openMenu")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-base font-semibold tracking-tight">VaultCTL</span>
          <div className="ml-auto flex items-center gap-0.5">
            <QuickActions />
            <ProfileMenu align="down" compact />
          </div>
        </header>

        <main
          id="main-content"
          className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8"
          role="main"
        >
          {features.mailer && features.emailVerification && <VerifyEmailBanner />}
          {features.updates && <UpdateBanner />}
          <div key={pathname} className="animate-fade-up">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
