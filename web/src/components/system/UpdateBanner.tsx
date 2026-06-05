// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { ArrowUpCircle, X } from "lucide-react";
import {
  snoozeUpdate,
  getLastSeenVersion,
  setLastSeenVersion,
} from "@/lib/system-api";
import { useUpdateNotification } from "@/hooks/use-update-notification";
import { WhatsNewModal } from "@/components/system/WhatsNewModal";

function parseable(v?: string): boolean {
  return !!v && /^\d+\.\d+\.\d+$/.test(v.replace(/^v/, ""));
}

export function UpdateBanner() {
  const { t } = useTranslation(["system", "common"]);
  const { status: data, show } = useUpdateNotification();

  const [dismissed, setDismissed] = useState(false);
  const [modal, setModal] = useState<"available" | "whatsnew" | null>(null);

  // Post-update "what's new": when the running version has changed since the
  // last one this device saw, show the notes once. First-ever load just records
  // the version silently.
  useEffect(() => {
    if (!data || !parseable(data.currentVersion)) return;
    const lastSeen = getLastSeenVersion();
    if (lastSeen && lastSeen !== data.currentVersion) {
      setModal("whatsnew");
    }
    if (lastSeen !== data.currentVersion) {
      setLastSeenVersion(data.currentVersion);
    }
  }, [data]);

  const showBanner = show && !dismissed;

  return (
    <>
      {showBanner && data && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-brand/30 bg-brand/10 px-4 py-2.5 text-sm">
          <ArrowUpCircle className="h-4 w-4 shrink-0 text-brand" />
          <span className="min-w-0">
            <Trans
              t={t}
              i18nKey="update.available"
              values={{ version: data.latestVersion }}
              components={{ 1: <strong /> }}
            />
            {data.severity && data.severity !== "none"
              ? t("update.severitySuffix", { severity: data.severity })
              : ""}
            . {t("update.youAreOn", { version: data.currentVersion })}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setModal("available")}
              className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-[#042f2a] hover:bg-brand/90"
            >
              {t("update.whatsNew")}
            </button>
            <button
              onClick={() => {
                snoozeUpdate(24);
                setDismissed(true);
              }}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("update.remindLater")}
            </button>
            <button
              onClick={() => setDismissed(true)}
              aria-label={t("common:actions.dismiss")}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {modal && data && (
        <WhatsNewModal
          mode={modal}
          version={modal === "available" ? data.latestVersion : data.currentVersion}
          notes={data.releaseNotes}
          releaseUrl={data.releaseUrl}
          onClose={() => setModal(null)}
          onRemindLater={() => {
            snoozeUpdate(24);
            setDismissed(true);
            setModal(null);
          }}
        />
      )}
    </>
  );
}
