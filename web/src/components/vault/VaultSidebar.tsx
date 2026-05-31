// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { apiGet } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { useAuthStore } from "@/lib/auth-store";
import { lock as lockKeys, terminate as terminateWorker } from "@/lib/key-holder";
import type { VaultResponse } from "@/shared/types/api";
import { FolderList } from "@/components/vault/FolderList";
import { BrandMark } from "@/components/BrandMark";
import { useTheme } from "@/hooks/use-theme";
import {
  KeyRound,
  Star,
  Trash2,
  FolderClosed,
  Lock,
  LogOut,
  Plus,
  Sun,
  Moon,
  Settings,
  X,
} from "lucide-react";

const navLink =
  "row-interactive flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground hover:translate-x-0.5 [&.active]:bg-accent [&.active]:text-foreground";

interface Props {
  open?: boolean;
  onClose?: () => void;
}

export function VaultSidebar({ open = false, onClose }: Props) {
  const { vaultId } = useParams({ strict: false }) as { vaultId?: string };
  const logout = useAuthStore((s) => s.logout);
  const { theme, toggleTheme } = useTheme();

  const { data: vaults } = useQuery({
    queryKey: queryKeys.vaults.list(),
    queryFn: () => apiGet<VaultResponse[]>("/api/v1/vaults"),
  });

  const activeVault = vaults?.find((v) => v.id === vaultId) ?? vaults?.[0];

  function handleLock() {
    lockKeys();
    useAuthStore.getState().lock();
  }

  function handleLogout() {
    terminateWorker();
    logout();
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-full w-64 transform flex-col border-r border-border bg-card/95 backdrop-blur-md transition-transform duration-300 md:static md:z-auto md:translate-x-0 md:bg-card/60 ${
        open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <BrandMark className="text-[32px] text-brand" />
        <BrandMark variant="wordmark" className="text-[17px]" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent/60 hover:text-foreground md:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Vault selector */}
      <div className="border-b border-border px-3 py-3">
        <div className="px-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Vaults
        </div>
        <div className="mt-1.5 space-y-0.5">
          {vaults?.map((v) => (
            <Link
              key={v.id}
              to="/vault/$vaultId"
              params={{ vaultId: v.id }}
              className={`${navLink} ${v.id === activeVault?.id ? "active" : ""}`}
            >
              <KeyRound className="h-4 w-4 shrink-0" />
              <span className="truncate">{v.name}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Navigation */}
      {activeVault && (
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          <Link
            to="/vault/$vaultId"
            params={{ vaultId: activeVault.id }}
            className={navLink}
            activeOptions={{ exact: true }}
          >
            <FolderClosed className="h-4 w-4" />
            All Items
          </Link>
          <Link
            to="/vault/$vaultId"
            params={{ vaultId: activeVault.id }}
            search={{ favorites: true } as never}
            className={navLink}
          >
            <Star className="h-4 w-4" />
            Favorites
          </Link>
          <Link
            to="/vault/$vaultId/trash"
            params={{ vaultId: activeVault.id }}
            className={navLink}
          >
            <Trash2 className="h-4 w-4" />
            Trash
          </Link>

          {/* Folders */}
          <div className="pt-2">
            <FolderList />
          </div>

          <div className="pt-2">
            <Link
              to="/vault/$vaultId/items/new"
              params={{ vaultId: activeVault.id }}
              className="row-interactive flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-brand hover:bg-brand/10 hover:translate-x-0.5"
            >
              <Plus className="h-4 w-4" />
              New Item
            </Link>
          </div>
        </nav>
      )}

      {/* Footer actions */}
      <div className="space-y-0.5 border-t border-border px-3 py-3">
        <Link to="/settings" className={navLink}>
          <Settings className="h-4 w-4" />
          Settings
        </Link>
        <button onClick={toggleTheme} className={`${navLink} w-full`}>
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
        <button onClick={handleLock} className={`${navLink} w-full`}>
          <Lock className="h-4 w-4" />
          Lock Vault
        </button>
        <button
          onClick={handleLogout}
          className="row-interactive flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:translate-x-0.5"
        >
          <LogOut className="h-4 w-4" />
          Log Out
        </button>
      </div>
    </aside>
  );
}
