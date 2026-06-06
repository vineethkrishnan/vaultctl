// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Settings, LogOut, ChevronUp, ShieldCheck, Activity } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { terminate as terminateWorker } from "@/lib/key-holder";
import { postAuthLogout } from "@/api/auth/auth";

interface Profile {
  name?: string;
  email?: string;
}

function initials(label: string): string {
  const s = label.trim();
  if (!s) return "?";
  const words = s.split(/\s+/);
  if (words.length >= 2 && !s.includes("@")) {
    return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
  }
  return (s.split("@")[0] ?? s).slice(0, 2).toUpperCase();
}

// Deterministic, pleasant background colour from the seed (name/email).
function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 50% 42%)`;
}

interface Props {
  // Which way the popover opens: "up" in the desktop sidebar footer, "down"
  // in the mobile top bar.
  align?: "up" | "down";
  // Compact hides the name/email text, showing just the avatar (mobile).
  compact?: boolean;
  onNavigate?: () => void;
}

export function ProfileMenu({ align = "up", compact = false, onNavigate }: Props) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);

  const { data } = useQuery({
    queryKey: ["users", "me"],
    queryFn: () => apiGet<Profile>("/api/v1/users/me"),
    staleTime: 10 * 60 * 1000,
  });
  const email = data?.email || sessionStorage.getItem("vaultctl_email") || "";
  const name = data?.name || "";
  const display = name || email || t("profileMenu.account");
  const seed = email || name || "vaultctl";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    firstItemRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  async function handleLogout() {
    const { refreshToken } = useAuthStore.getState();
    try {
      if (refreshToken) await postAuthLogout({ refreshToken });
    } catch {
      // best effort: always tear down locally
    }
    terminateWorker();
    useAuthStore.getState().logout();
    window.location.assign("/login");
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-accent/60 ${compact ? "justify-center" : ""}`}
        aria-label={t("profileMenu.accountMenu")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: avatarColor(seed) }}
          aria-hidden="true"
        >
          {initials(display)}
        </span>
        {!compact && (
          <span className="min-w-0 flex-1">
            {name && <span className="block truncate text-sm font-medium">{name}</span>}
            <span className="block truncate text-xs text-muted-foreground">{email}</span>
          </span>
        )}
        {!compact && <ChevronUp className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "rotate-180"}`} />}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute right-0 z-50 w-48 rounded-lg border border-border bg-card p-1 shadow-lg ${
            align === "up" ? "bottom-full mb-1" : "top-full mt-1"
          } ${compact ? "" : "left-0"}`}
        >
          <Link
            ref={firstItemRef}
            to="/health"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <ShieldCheck className="h-4 w-4" />
            {t("profileMenu.security")}
          </Link>
          <Link
            to="/activity"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <Activity className="h-4 w-4" />
            {t("profileMenu.activity")}
          </Link>
          <Link
            to="/settings"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
            {t("profileMenu.settings")}
          </Link>
          <button
            role="menuitem"
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            {t("profileMenu.logOut")}
          </button>
        </div>
      )}
    </div>
  );
}
