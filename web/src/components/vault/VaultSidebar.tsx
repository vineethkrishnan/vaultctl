import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { apiGet } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { useAuthStore } from "@/lib/auth-store";
import { lock as lockKeys, terminate as terminateWorker } from "@/lib/key-holder";
import type { VaultResponse } from "@/shared/types/api";
import { FolderList } from "@/components/vault/FolderList";
import { useTheme } from "@/hooks/use-theme";
import {
  KeyRound,
  Star,
  Trash2,
  FolderClosed,
  Lock,
  LogOut,
  Plus,
  Shield,
  ShieldAlert,
  Sun,
  Moon,
  Settings,
} from "lucide-react";

export function VaultSidebar() {
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
    <aside className="flex h-full w-64 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Shield className="h-5 w-5 text-primary" />
        <span className="text-lg font-semibold">vaultctl</span>
      </div>

      {/* Vault selector */}
      <div className="border-b border-border px-3 py-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Vaults
        </div>
        <div className="mt-1 space-y-0.5">
          {vaults?.map((v) => (
            <Link
              key={v.id}
              to="/vault/$vaultId"
              params={{ vaultId: v.id }}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                v.id === activeVault?.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <KeyRound className="h-4 w-4" />
              {v.name}
            </Link>
          ))}
        </div>
      </div>

      {/* Navigation */}
      {activeVault && (
        <nav className="flex-1 space-y-1 px-3 py-2">
          <Link
            to="/vault/$vaultId"
            params={{ vaultId: activeVault.id }}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
            activeOptions={{ exact: true }}
          >
            <FolderClosed className="h-4 w-4" />
            All Items
          </Link>
          <Link
            to="/vault/$vaultId"
            params={{ vaultId: activeVault.id }}
            search={{ favorites: true } as never}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <Star className="h-4 w-4" />
            Favorites
          </Link>
          <Link
            to="/vault/$vaultId/trash"
            params={{ vaultId: activeVault.id }}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
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
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-primary hover:bg-accent/50"
            >
              <Plus className="h-4 w-4" />
              New Item
            </Link>
          </div>
        </nav>
      )}

      {/* Footer actions */}
      <div className="border-t border-border px-3 py-2 space-y-0.5">
        <Link
          to="/settings"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
        <Link
          to="/admin"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
        >
          <ShieldAlert className="h-4 w-4" />
          Admin
        </Link>
        <button
          onClick={toggleTheme}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
        <button
          onClick={handleLock}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <Lock className="h-4 w-4" />
          Lock Vault
        </button>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Log Out
        </button>
      </div>
    </aside>
  );
}
