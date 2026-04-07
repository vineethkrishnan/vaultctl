import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiDelete } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { decryptName } from "@/lib/key-holder";
import { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS } from "@/components/vault/ItemList";
import type { ItemResponse } from "@/shared/types/api";
import { RotateCcw, Trash2, KeyRound } from "lucide-react";

interface DecryptedItem extends ItemResponse {
  decryptedName: string;
}

export function VaultTrashPage() {
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };
  const queryClient = useQueryClient();

  const { data: items, isLoading } = useQuery({
    queryKey: queryKeys.trash.list(vaultId),
    queryFn: () =>
      apiGet<ItemResponse[]>(`/api/v1/vaults/${vaultId}/trash`),
    enabled: !!vaultId,
  });

  const [decryptedItems, setDecryptedItems] = useState<DecryptedItem[]>([]);

  useEffect(() => {
    if (!items) return;
    let cancelled = false;

    async function decrypt() {
      const results: DecryptedItem[] = [];
      for (const item of items!) {
        try {
          const name = await decryptName(vaultId, item.encryptedName);
          results.push({ ...item, decryptedName: name });
        } catch {
          results.push({ ...item, decryptedName: "[decryption failed]" });
        }
      }
      if (!cancelled) setDecryptedItems(results);
    }

    decrypt();
    return () => { cancelled = true; };
  }, [items, vaultId]);

  const restoreMutation = useMutation({
    mutationFn: (itemId: string) =>
      apiPost(`/api/v1/vaults/${vaultId}/trash/${itemId}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trash.list(vaultId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.items.all(vaultId) });
    },
  });

  const purgeMutation = useMutation({
    mutationFn: (itemId: string) =>
      apiDelete(`/api/v1/vaults/${vaultId}/trash/${itemId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trash.list(vaultId) });
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <h1 className="mb-4 text-xl font-bold">Trash</h1>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">Trash</h1>

      {!decryptedItems.length ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Trash is empty
        </p>
      ) : (
        <div className="space-y-1">
          {decryptedItems.map((item) => {
            const Icon = ITEM_TYPE_ICONS[item.itemType] ?? KeyRound;
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent/50"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {item.decryptedName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {ITEM_TYPE_LABELS[item.itemType] ?? item.itemType}
                  </div>
                </div>
                <button
                  onClick={() => restoreMutation.mutate(item.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                  title="Restore"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm("Permanently delete this item?")) {
                      purgeMutation.mutate(item.id);
                    }
                  }}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
                  title="Delete permanently"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
