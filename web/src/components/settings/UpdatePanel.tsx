// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
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

const LEVELS: { value: NotifyLevel; label: string }[] = [
  { value: "all", label: "All updates (patches, minor & major)" },
  { value: "minor", label: "Minor & major only" },
  { value: "major", label: "Major only" },
  { value: "off", label: "Don't notify me" },
];

export function UpdatePanel() {
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
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            )}
            Software updates
          </span>
          <span className="block text-xs text-muted-foreground">
            {!data
              ? "Checking for updates..."
              : !data.enabled
                ? "Update checking is disabled on this server."
                : data.updateAvailable
                  ? `v${data.latestVersion} is available${data.severity && data.severity !== "none" ? ` (${data.severity})` : ""} - you're on v${data.currentVersion}.`
                  : `You're on the latest version (v${data.currentVersion}).`}
          </span>
        </span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Check now
        </button>
      </div>

      {data?.updateAvailable && (
        <button
          onClick={() => setShowNotes(true)}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          What's new in v{data.latestVersion}
        </button>
      )}

      <div className="space-y-1 pt-1">
        <label htmlFor="notify-level" className="text-xs font-medium text-muted-foreground">
          Notify me about
        </label>
        <select
          id="notify-level"
          value={level}
          onChange={(e) => changeLevel(e.target.value as NotifyLevel)}
          className="block rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          The self-hosted server is updated by your administrator; vaultctl shows
          a banner with the release notes when a new version is published.
        </p>
      </div>

      {upToDate && <span className="sr-only">Up to date</span>}

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
