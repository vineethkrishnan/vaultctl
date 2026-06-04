// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, Sun, Moon, Lock } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { useAuthStore } from "@/lib/auth-store";
import { lock as lockKeys } from "@/lib/key-holder";
import { getNotifications } from "@/lib/system-api";
import { useUpdateNotification } from "@/hooks/use-update-notification";

// QuickActions is the always-one-tap row: notifications (with unread badge),
// theme toggle, and lock. Shared by the desktop sidebar footer and the mobile
// top bar, so these stay immediately reachable everywhere.
export function QuickActions({ onNavigate }: { onNavigate?: () => void }) {
  const { theme, toggleTheme } = useTheme();
  const { data: notifications } = useQuery({
    queryKey: ["system", "notifications"],
    queryFn: getNotifications,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const { show: showUpdate } = useUpdateNotification();
  const unread = (notifications?.unreadCount ?? 0) + (showUpdate ? 1 : 0);

  function lockVault() {
    lockKeys();
    useAuthStore.getState().lock();
  }

  const btn =
    "relative flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-foreground";

  return (
    <div className="flex items-center gap-1">
      <Link
        to="/notifications"
        onClick={onNavigate}
        className={btn}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[1.05rem] items-center justify-center rounded-full bg-brand px-1 text-[0.6rem] font-semibold leading-[1.05rem] text-[#042f2a]">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
      <button onClick={toggleTheme} className={btn} aria-label="Toggle theme">
        {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>
      <button onClick={lockVault} className={btn} aria-label="Lock vault">
        <Lock className="h-5 w-5" />
      </button>
    </div>
  );
}
