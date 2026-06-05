// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiDelete, ApiRequestError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { decryptName } from "@/lib/key-holder";
import { ITEM_TYPE_ICONS } from "@/components/vault/ItemList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StepUpModal } from "@/components/auth/StepUpModal";
import type { ItemResponse } from "@/shared/types/api";
import { RotateCcw, Trash2, KeyRound, AlertTriangle } from "lucide-react";

interface DecryptedItem extends ItemResponse {
  decryptedName: string;
}

export function VaultTrashPage() {
  const { t } = useTranslation(["vault", "common"]);
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
          results.push({ ...item, decryptedName: t("vault:trash.decryptionFailed") });
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

  const [pendingPurge, setPendingPurge] = useState<DecryptedItem | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const purgeTargetId = useRef<string | null>(null);

  const purgeMutation = useMutation({
    mutationFn: (itemId: string) =>
      apiDelete(`/api/v1/vaults/${vaultId}/trash/${itemId}`),
    onSuccess: () => {
      // Permanent delete removes it from trash; the active list is unaffected.
      queryClient.invalidateQueries({ queryKey: queryKeys.trash.list(vaultId) });
    },
  });

  // Permanent delete requires a step-up (master password). On the 403 the server
  // returns, prompt for it and retry once the elevated token is in the store.
  async function runPurge(itemId: string) {
    setPurgeError(null);
    try {
      await purgeMutation.mutateAsync(itemId);
      purgeTargetId.current = null;
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.error.code === "STEP_UP_REQUIRED"
      ) {
        purgeTargetId.current = itemId;
        setStepUpOpen(true);
        return;
      }
      setPurgeError(
        err instanceof Error ? err.message : t("vault:trash.deleteError"),
      );
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <h1 className="mb-4 text-xl font-bold">{t("vault:trash.title")}</h1>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">Trash</h1>

      {purgeError && (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {purgeError}
        </div>
      )}

      {!decryptedItems.length ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {t("vault:trash.empty")}
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
                    {t(`vault:itemTypes.${item.itemType}`)}
                  </div>
                </div>
                <button
                  onClick={() => restoreMutation.mutate(item.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                  title={t("vault:trash.restore")}
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPendingPurge(item)}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
                  title={t("vault:trash.deletePermanently")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingPurge}
        title={t("vault:trash.purgeConfirm.title")}
        message={
          pendingPurge
            ? t("vault:trash.purgeConfirm.message", {
                name: pendingPurge.decryptedName,
              })
            : ""
        }
        confirmLabel={t("vault:trash.purgeConfirm.confirmLabel")}
        destructive
        busy={purgeMutation.isPending}
        onConfirm={() => {
          const target = pendingPurge;
          setPendingPurge(null);
          if (target) void runPurge(target.id);
        }}
        onCancel={() => setPendingPurge(null)}
      />

      <StepUpModal
        open={stepUpOpen}
        onSuccess={() => {
          setStepUpOpen(false);
          const id = purgeTargetId.current;
          if (id) void runPurge(id);
        }}
        onCancel={() => {
          setStepUpOpen(false);
          purgeTargetId.current = null;
        }}
      />
    </div>
  );
}
