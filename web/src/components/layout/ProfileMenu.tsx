// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Settings, LogOut, ChevronUp } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["users", "me"],
    queryFn: () => apiGet<Profile>("/api/v1/users/me"),
    staleTime: 10 * 60 * 1000,
  });
  const email = data?.email || sessionStorage.getItem("vaultctl_email") || "";
  const name = data?.name || "";
  const display = name || email || "Account";
  const seed = email || name || "vaultctl";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
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
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-accent/60 ${compact ? "justify-center" : ""}`}
        aria-label="Account menu"
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
            to="/settings"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
          <button
            role="menuitem"
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}
