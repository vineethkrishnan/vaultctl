// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import type { VaultResponse } from "@/shared/types/api";
import { useVaultTrustStore } from "@/lib/vault-trust-store";

/**
 * Names the vaults the crypto worker refused at unlock (H1).
 *
 * A failed wrap signature means the key material did not come from who the
 * server says it came from, so the vault stays closed. That has to be stated,
 * not implied by absence.
 */
export function UntrustedVaultBanner() {
  const { t } = useTranslation("vault");
  const rejectedVaultIds = useVaultTrustStore((s) => s.rejectedVaultIds);

  const { data: vaults } = useQuery({
    queryKey: queryKeys.vaults.list(),
    queryFn: () => apiGet<VaultResponse[]>("/api/v1/vaults"),
    enabled: rejectedVaultIds.length > 0,
  });

  if (rejectedVaultIds.length === 0) return null;

  const names = rejectedVaultIds.map(
    (vaultId) => vaults?.find((vault) => vault.id === vaultId)?.name ?? vaultId,
  );

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
      <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
      <span className="min-w-0">
        {t("untrustedVaults.banner", {
          count: names.length,
          vaults: names.join(", "),
        })}
      </span>
    </div>
  );
}
