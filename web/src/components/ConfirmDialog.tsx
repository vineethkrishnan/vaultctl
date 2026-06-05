// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Themed replacement for window.confirm - overlay + card matching the app. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation("common");
  const resolvedConfirmLabel = confirmLabel ?? t("actions.confirm");
  const resolvedCancelLabel = cancelLabel ?? t("actions.cancel");

  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 pb-4 pt-[12vh]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="animate-scale-in w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-3 flex items-center gap-2">
          {destructive && (
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          )}
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-input px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {resolvedCancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
              destructive
                ? "bg-destructive text-white hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
          >
            {busy ? t("actions.working") : resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
