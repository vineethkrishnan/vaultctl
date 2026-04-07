import { Outlet } from "@tanstack/react-router";
import { VaultSidebar } from "@/components/vault/VaultSidebar";
import { useAutoLock } from "@/hooks/use-auto-lock";
import { useCryptoWorker } from "@/hooks/use-crypto-worker";

export function AuthLayout() {
  // Wire Worker locked event → auth store
  useCryptoWorker();
  // Auto-lock on inactivity (15 min default)
  useAutoLock();

  return (
    <div className="flex h-screen overflow-hidden">
      <VaultSidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
