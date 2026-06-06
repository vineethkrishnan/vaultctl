// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import zxcvbn from "zxcvbn";
import { apiGet } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { decryptData, decryptName } from "@/lib/key-holder";
import { sha256 } from "@/shared/crypto";
import {
  analyzeHealth,
  type HealthInput,
  type HealthItemRef,
  type HealthReport,
} from "@/shared/health/analyze";
import type { ItemResponse, VaultResponse } from "@/shared/types/api";
import {
  ShieldCheck,
  ShieldAlert,
  Copy as CopyIcon,
  Clock,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";

const decoder = new TextDecoder();

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

async function collectLoginItems(
  vaults: VaultResponse[],
): Promise<HealthInput[]> {
  const collected: HealthInput[] = [];
  for (const vault of vaults) {
    let items: ItemResponse[];
    try {
      items = await apiGet<ItemResponse[]>(`/api/v1/vaults/${vault.id}/items`);
    } catch {
      continue;
    }
    for (const item of items) {
      if (item.itemType !== "login" || item.reprompt) continue;
      let name = "";
      let username = "";
      let password = "";
      try {
        name = await decryptName(vault.id, item.encryptedName);
        const raw = JSON.parse(
          decoder.decode(await decryptData(vault.id, item.encryptedData)),
        ) as { username?: string; password?: string };
        username = raw.username ?? "";
        password = raw.password ?? "";
      } catch {
        continue;
      }
      collected.push({
        id: item.id,
        vaultId: vault.id,
        name,
        username,
        password,
        updatedAt: item.updatedAt,
      });
    }
  }
  return collected;
}

export function HealthPage() {
  const { t } = useTranslation(["health", "common"]);

  const { data: vaults } = useQuery({
    queryKey: queryKeys.vaults.list(),
    queryFn: () => apiGet<VaultResponse[]>("/api/v1/vaults"),
  });

  const [report, setReport] = useState<HealthReport | null>(null);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    if (!vaults) return;
    let cancelled = false;
    setScanning(true);

    async function run() {
      const items = await collectLoginItems(vaults!);

      const fingerprints = new Map<string, string>();
      for (const item of items) {
        if (!item.password) continue;
        const digest = await sha256(new TextEncoder().encode(item.password));
        fingerprints.set(item.id, toHex(digest));
      }

      const next = analyzeHealth(
        items,
        (password) => zxcvbn(password).score,
        fingerprints,
      );
      if (!cancelled) {
        setReport(next);
        setScanning(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [vaults]);

  const issueCount = useMemo(() => {
    if (!report) return 0;
    return report.weak.length + report.reused.length + report.stale.length;
  }, [report]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <ShieldCheck className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("health:title")}</h1>
          <p className="text-sm text-muted-foreground">{t("health:subtitle")}</p>
        </div>
      </div>

      {scanning || !report ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card/40 px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("health:scanning")}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard label={t("health:summary.checked")} value={report.withPassword} tone="muted" />
            <SummaryCard label={t("health:summary.weak")} value={report.weak.length} tone="warn" />
            <SummaryCard label={t("health:summary.reused")} value={report.reusedItemCount} tone="warn" />
            <SummaryCard label={t("health:summary.stale")} value={report.stale.length} tone="warn" />
          </div>

          {issueCount === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card/40 px-4 py-8 text-sm">
              <ShieldCheck className="h-5 w-5 text-green-500" />
              <span>{t("health:allClear")}</span>
            </div>
          ) : (
            <div className="space-y-4">
              <IssueSection
                icon={ShieldAlert}
                title={t("health:weak.title")}
                description={t("health:weak.description")}
                count={report.weak.length}
                emptyLabel={t("health:weak.empty")}
              >
                {report.weak.map((entry) => (
                  <ItemRow
                    key={entry.id}
                    item={entry}
                    badge={t(`health:weak.score.${entry.score}`)}
                  />
                ))}
              </IssueSection>

              <IssueSection
                icon={CopyIcon}
                title={t("health:reused.title")}
                description={t("health:reused.description")}
                count={report.reused.length}
                emptyLabel={t("health:reused.empty")}
              >
                {report.reused.map((group, index) => (
                  <div key={group.fingerprint} className="space-y-1 py-1">
                    <div className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("health:reused.group", {
                        index: index + 1,
                        count: group.items.length,
                      })}
                    </div>
                    {group.items.map((item) => (
                      <ItemRow key={item.id} item={item} />
                    ))}
                  </div>
                ))}
              </IssueSection>

              <IssueSection
                icon={Clock}
                title={t("health:stale.title")}
                description={t("health:stale.description")}
                count={report.stale.length}
                emptyLabel={t("health:stale.empty")}
              >
                {report.stale.map((entry) => (
                  <ItemRow
                    key={entry.id}
                    item={entry}
                    badge={t("health:stale.age", {
                      months: Math.floor(entry.ageDays / 30),
                    })}
                  />
                ))}
              </IssueSection>
            </div>
          )}

          <p className="text-xs text-muted-foreground">{t("health:privacyNote")}</p>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "warn";
}) {
  const warn = tone === "warn" && value > 0;
  return (
    <div className="rounded-xl border border-border bg-card/40 px-3 py-3">
      <div
        className={`text-2xl font-bold tabular-nums ${
          warn ? "text-amber-500" : "text-foreground"
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function IssueSection({
  icon: Icon,
  title,
  description,
  count,
  emptyLabel,
  children,
}: {
  icon: typeof ShieldAlert;
  title: string;
  description: string;
  count: number;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(count > 0);
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/40"
      >
        <Icon className={`h-5 w-5 ${count > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{description}</div>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
          {count}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-border/60 py-1">
          {count === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}

function ItemRow({ item, badge }: { item: HealthItemRef; badge?: string }) {
  return (
    <Link
      to="/vault/$vaultId/items/$itemId"
      params={{ vaultId: item.vaultId, itemId: item.id }}
      className="row-interactive flex items-center gap-3 px-4 py-2 hover:bg-accent/50"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{item.name}</div>
        {item.username && (
          <div className="truncate text-xs text-muted-foreground">{item.username}</div>
        )}
      </div>
      {badge && (
        <span className="shrink-0 rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          {badge}
        </span>
      )}
    </Link>
  );
}
