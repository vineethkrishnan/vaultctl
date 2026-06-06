// SPDX-License-Identifier: AGPL-3.0-or-later

// Irreversible vault deletion behind two confirmations: the user must type
// the exact vault name, then pass a master-password step-up. The server
// additionally enforces the step-up and owner-only access.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { apiDelete } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { StepUpModal } from "@/components/auth/StepUpModal";

interface Props {
  vaultId: string;
  vaultName: string;
  onClose: () => void;
}

export function DeleteVaultDialog({ vaultId, vaultName, onClose }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [typedName, setTypedName] = useState("");
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameMatches = typedName === vaultName;

  useEffect(() => {
    inputRef.current?.focus();
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !stepUpOpen && !deleting) onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose, stepUpOpen, deleting]);

  async function performDelete() {
    setDeleting(true);
    setError(null);
    try {
      await apiDelete(`/api/v1/vaults/${vaultId}`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.vaults.list() });
      navigate({ to: "/" });
    } catch (err) {
      setDeleting(false);
      setError(err instanceof Error ? err.message : t("vault:deleteVault.failed"));
    }
  }

  return (
    <>
      <div
        className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 pb-4 pt-[12vh]"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !deleting) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          className="animate-scale-in w-full max-w-md rounded-lg border border-destructive/40 bg-card p-6 shadow-xl"
        >
          <div className="mb-2 flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-lg font-semibold">{t("vault:deleteVault.title")}</h2>
          </div>
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
            {t("vault:deleteVault.warning", { name: vaultName })}
          </p>

          <label className="mb-1 block text-xs text-muted-foreground">
            {t("vault:deleteVault.typeToConfirm", { name: vaultName })}
          </label>
          <input
            ref={inputRef}
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={vaultName}
            autoComplete="off"
            spellCheck={false}
            className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-destructive/60 focus:ring-2 focus:ring-destructive/20"
          />

          {error && (
            <div className="mb-3 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="rounded-md border border-input px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {t("common:actions.cancel")}
            </button>
            <button
              type="button"
              disabled={!nameMatches || deleting}
              onClick={() => setStepUpOpen(true)}
              className="flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("vault:deleteVault.confirm")}
            </button>
          </div>
        </div>
      </div>

      <StepUpModal
        open={stepUpOpen}
        onSuccess={() => {
          setStepUpOpen(false);
          void performDelete();
        }}
        onCancel={() => setStepUpOpen(false)}
      />
    </>
  );
}
