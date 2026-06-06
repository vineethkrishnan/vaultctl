// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { History, Eye, EyeOff, Copy, Check } from "lucide-react";
import type { PasswordHistoryEntry } from "@/shared/types/item-data";

interface PasswordHistoryProps {
  entries: PasswordHistoryEntry[];
}

export function PasswordHistory({ entries }: PasswordHistoryProps) {
  const { t } = useTranslation(["vault", "common"]);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{t("vault:passwordHistory.heading")}</span>
        <span className="text-xs text-muted-foreground">
          ({entries.length})
        </span>
      </div>
      <ul className="space-y-1">
        {entries.map((entry, i) => (
          <PasswordHistoryRow key={i} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

function PasswordHistoryRow({ entry }: { entry: PasswordHistoryEntry }) {
  const { t } = useTranslation(["vault", "common"]);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(entry.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <li className="flex items-center justify-between rounded-md border border-border p-2 text-xs">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="font-mono truncate">
          {visible ? entry.password : "\u2022".repeat(Math.min(entry.password.length, 20))}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-muted-foreground">
          {formatDate(entry.changedAt)}
        </span>
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          title={visible ? t("vault:fields.hide") : t("vault:fields.show")}
        >
          {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          title={t("vault:fields.copy")}
        >
          {copied ? (
            <Check className="h-3 w-3 text-success" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
    </li>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
