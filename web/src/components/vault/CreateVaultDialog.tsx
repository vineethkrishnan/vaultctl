// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { createVaultKey, bindVaultKey } from "@/lib/key-holder";
import type { VaultResponse } from "@/shared/types/api";

interface Props {
  onClose: () => void;
}

export function CreateVaultDialog({ onClose }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    setSaving(true);
    const handle = `new-vault-${Date.now()}`;
    try {
      const wrap = await createVaultKey(handle);
      const vault = await apiPost<VaultResponse>("/api/v1/vaults", {
        name: trimmed,
        type: "personal",
        encryptedVaultKey: wrap.encryptedVaultKey,
        wrapSignature: wrap.wrapSignature,
      });
      await bindVaultKey(handle, vault.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.vaults.list() });
      onClose();
      navigate({ to: "/vault/$vaultId", params: { vaultId: vault.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("vault:createVault.failed"));
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("vault:createVault.title")}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-5 shadow-xl"
      >
        <h2 className="text-lg font-semibold">{t("vault:createVault.title")}</h2>

        {error && (
          <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="new-vault-name" className="text-sm font-medium">
              {t("vault:createVault.nameLabel")}
            </label>
            <input
              id="new-vault-name"
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              placeholder={t("vault:createVault.namePlaceholder")}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {t("common:actions.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? t("common:actions.working") : t("vault:createVault.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
