// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import { Link, useParams } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { ItemList } from "@/components/vault/ItemList";
import { SharingPanel } from "@/components/vault/SharingPanel";

export function VaultItemsPage() {
  const { t } = useTranslation(["vault", "common"]);
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };

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

      <ItemList />

      <section className="rounded-xl border border-border bg-card/40 p-5">
        <SharingPanel />
      </section>
    </div>
  );
}
