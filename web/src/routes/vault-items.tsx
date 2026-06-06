// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import type { ItemResponse, VaultResponse } from "@/shared/types/api";
import { ItemList } from "@/components/vault/ItemList";
import { SharingPanel } from "@/components/vault/SharingPanel";
import { OnboardingChecklist } from "@/components/vault/OnboardingChecklist";
import { DeleteVaultDialog } from "@/components/vault/DeleteVaultDialog";

export function VaultItemsPage() {
  const { t } = useTranslation(["vault", "common"]);
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Shares the unfiltered items query key with ItemList, so this only drives
  // the onboarding checklist's hasItems flag without a second network request.
  const { data: items } = useQuery({
    queryKey: [...queryKeys.items.list(vaultId), ""],
    queryFn: () => apiGet<ItemResponse[]>(`/api/v1/vaults/${vaultId}/items`),
    enabled: !!vaultId && vaultId !== "none",
  });

  // Shares the sidebar's vault-list query; drives the danger zone (owner-only
  // delete, disabled on the last remaining vault).
  const { data: vaults } = useQuery({
    queryKey: queryKeys.vaults.list(),
    queryFn: () => apiGet<VaultResponse[]>("/api/v1/vaults"),
  });
  const vault = vaults?.find((v) => v.id === vaultId);
  const isOwner = vault?.role === "owner";
  const isLastVault = (vaults?.length ?? 0) <= 1;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("vault:items.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("vault:items.subtitle")}
          </p>
        </div>
        <Link
          to="/vault/$vaultId/items/new"
          params={{ vaultId }}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t("vault:items.newItem")}
        </Link>
      </div>

      {vaultId && vaultId !== "none" && items?.length === 0 && (
        <OnboardingChecklist vaultId={vaultId} hasItems={false} />
      )}

      <ItemList />

      <section className="rounded-xl border border-border bg-card/40 p-5">
        <SharingPanel />
      </section>

      {vault && isOwner && (
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <h2 className="font-semibold text-destructive">
            {t("vault:deleteVault.dangerZone")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLastVault
              ? t("vault:deleteVault.lastVaultHint")
              : t("vault:deleteVault.description")}
          </p>
          <button
            type="button"
            disabled={isLastVault}
            onClick={() => setConfirmingDelete(true)}
            className="mt-3 flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            {t("vault:deleteVault.action")}
          </button>
        </section>
      )}

      {confirmingDelete && vault && (
        <DeleteVaultDialog
          vaultId={vault.id}
          vaultName={vault.name}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
