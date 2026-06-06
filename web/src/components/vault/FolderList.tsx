// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { decryptName, encryptName } from "@/lib/key-holder";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { FolderResponse } from "@/shared/types/api";
import { FolderClosed, Plus, Pencil, Trash2, Check, X } from "lucide-react";

interface DecryptedFolder extends FolderResponse {
  decryptedName: string;
}

// Common starting folders offered as one-click suggestions. They are only
// hints - nothing is created until the user picks one.
const PRESET_FOLDERS = [
  "Personal",
  "Work",
  "Temporary",
  "Finance",
  "Social",
  "Email",
  "Shopping",
  "Developer",
  "Servers",
];

export function FolderList() {
  const { t } = useTranslation(["vault", "common"]);
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };
  const queryClient = useQueryClient();

  const { data: folders } = useQuery({
    queryKey: queryKeys.folders.list(vaultId),
    queryFn: () =>
      apiGet<FolderResponse[]>(`/api/v1/vaults/${vaultId}/folders`),
    enabled: !!vaultId && vaultId !== "none",
  });

  const [decryptedFolders, setDecryptedFolders] = useState<DecryptedFolder[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DecryptedFolder | null>(null);

  useEffect(() => {
    if (!folders) return;
    let cancelled = false;

    async function decrypt() {
      const results: DecryptedFolder[] = [];
      for (const f of folders!) {
        try {
          const name = await decryptName(vaultId, f.encryptedName);
          results.push({ ...f, decryptedName: name });
        } catch {
          results.push({ ...f, decryptedName: t("vault:folders.decryptError") });
        }
      }
      if (!cancelled) setDecryptedFolders(results);
    }

    decrypt();
    return () => { cancelled = true; };
  }, [folders, vaultId]);

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const encName = await encryptName(vaultId, name);
      return apiPost(`/api/v1/vaults/${vaultId}/folders`, {
        encryptedName: encName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.folders.list(vaultId) });
      setCreating(false);
      setNewName("");
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ folderId, name }: { folderId: string; name: string }) => {
      const encName = await encryptName(vaultId, name);
      return apiPut(`/api/v1/vaults/${vaultId}/folders/${folderId}`, {
        encryptedName: encName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.folders.list(vaultId) });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (folderId: string) =>
      apiDelete(`/api/v1/vaults/${vaultId}/folders/${folderId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.folders.list(vaultId) });
    },
  });

  if (!folders?.length && !creating) {
    return (
      <div className="space-y-1">
        <button
          onClick={() => setCreating(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("vault:folders.newFolder")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <div className="mb-1 flex items-center justify-between px-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("vault:folders.heading")}
        </span>
        <button
          onClick={() => setCreating(true)}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          title={t("vault:folders.newFolderTitle")}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {creating && (
        <div className="px-2 py-1">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) createMutation.mutate(newName.trim());
            }}
            className="flex items-center gap-1"
          >
            <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              placeholder={t("vault:folders.namePlaceholder")}
              className="w-full bg-transparent text-sm outline-none"
            />
            <button type="submit" className="text-primary">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName(""); }}
              className="text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </form>

          {(() => {
            const existing = new Set(
              decryptedFolders.map((f) => f.decryptedName.toLowerCase()),
            );
            const suggestions = PRESET_FOLDERS.filter(
              (p) => !existing.has(p.toLowerCase()),
            );
            if (suggestions.length === 0) return null;
            return (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {suggestions.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={createMutation.isPending}
                    onClick={() => createMutation.mutate(preset)}
                    className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-brand/50 hover:text-foreground disabled:opacity-50"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {decryptedFolders.map((f) => (
        <div key={f.id} className="group flex items-center gap-1">
          {editingId === f.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (editName.trim()) renameMutation.mutate({ folderId: f.id, name: editName.trim() });
              }}
              className="flex flex-1 items-center gap-1 px-2 py-1"
            >
              <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                className="w-full bg-transparent text-sm outline-none"
              />
              <button type="submit" className="text-primary">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => setEditingId(null)} className="text-muted-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <Link
              to="/vault/$vaultId"
              params={{ vaultId }}
              search={{ folderId: f.id } as never}
              className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
            >
              <FolderClosed className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{f.decryptedName}</span>
            </Link>
          )}
          {editingId !== f.id && (
            <div className="hidden gap-0.5 group-hover:flex">
              <button
                onClick={() => { setEditingId(f.id); setEditName(f.decryptedName); }}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => setPendingDelete(f)}
                className="rounded p-0.5 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      ))}

      <ConfirmDialog
        open={!!pendingDelete}
        title={t("vault:folders.deleteConfirmTitle")}
        message={
          pendingDelete
            ? t("vault:folders.deleteConfirm", { name: pendingDelete.decryptedName })
            : ""
        }
        confirmLabel={t("common:actions.delete")}
        destructive
        busy={deleteMutation.isPending}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) deleteMutation.mutate(target.id);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
