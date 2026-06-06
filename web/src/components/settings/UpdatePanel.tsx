// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle, CheckCircle2, RefreshCw } from "lucide-react";
import {
  getUpdateStatus,
  getNotifyLevel,
  setNotifyLevel,
  clearSnooze,
  type NotifyLevel,
} from "@/lib/system-api";
import { WhatsNewModal } from "@/components/system/WhatsNewModal";

const LEVELS: NotifyLevel[] = ["all", "minor", "major", "off"];

export function UpdatePanel() {
  const { t } = useTranslation("settings");
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["system", "updates"],
    queryFn: getUpdateStatus,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const [level, setLevel] = useState<NotifyLevel>(() => getNotifyLevel());
  const [showNotes, setShowNotes] = useState(false);

  function changeLevel(next: NotifyLevel) {
    setLevel(next);
    setNotifyLevel(next);
    clearSnooze();
  }

  const upToDate = data && data.enabled && !data.updateAvailable;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {data?.updateAvailable ? (
              <ArrowUpCircle className="h-3.5 w-3.5 text-brand" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            )}
            {t("update.title")}
          </span>
          <span className="block text-xs text-muted-foreground">
            {!data
              ? t("update.checking")
              : !data.enabled
                ? t("update.disabled")
                : data.updateAvailable
                  ? t("update.available", {
                      version: data.latestVersion,
                      current: data.currentVersion,
                      severity:
                        data.severity && data.severity !== "none"
                          ? t("update.severitySuffix", { severity: data.severity })
                          : "",
                    })
                  : t("update.upToDateDetail", { current: data.currentVersion })}
          </span>
        </span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          {t("update.checkNow")}
        </button>
      </div>

      {data?.updateAvailable && (
        <button
          onClick={() => setShowNotes(true)}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("update.whatsNew", { version: data.latestVersion })}
        </button>
      )}

      <div className="space-y-1 pt-1">
        <label htmlFor="notify-level" className="text-xs font-medium text-muted-foreground">
          {t("update.notifyMeAbout")}
        </label>
        <select
          id="notify-level"
          value={level}
          onChange={(e) => changeLevel(e.target.value as NotifyLevel)}
          className="block rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {LEVELS.map((value) => (
            <option key={value} value={value}>
              {t(`update.levels.${value}`)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {t("update.notifyHint")}
        </p>
      </div>

      {upToDate && <span className="sr-only">{t("update.upToDate")}</span>}

      {showNotes && data && (
        <WhatsNewModal
          mode="available"
          version={data.latestVersion}
          notes={data.releaseNotes}
          releaseUrl={data.releaseUrl}
          onClose={() => setShowNotes(false)}
        />
      )}
    </div>
  );
}
