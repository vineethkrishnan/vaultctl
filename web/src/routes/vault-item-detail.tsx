// SPDX-License-Identifier: AGPL-3.0-or-later

import { useParams } from "@tanstack/react-router";
import { ItemEditor } from "@/components/vault/ItemEditor";

export function VaultItemDetailPage() {
  const { vaultId, itemId } = useParams({ strict: false }) as {
    vaultId: string;
    itemId: string;
  };

  return (
    <div className="mx-auto max-w-2xl">
      <ItemEditor vaultId={vaultId} itemId={itemId} />
    </div>
  );
}
