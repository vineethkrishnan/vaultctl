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
import { useServerFeatures } from "@/hooks/use-server-features";
import { WhatsNewModal } from "@/components/system/WhatsNewModal";
import { StepUpModal } from "@/components/auth/StepUpModal";
import { UpgradeModal } from "@/components/system/UpgradeModal";

function parseable(v?: string): boolean {
  return !!v && /^\d+\.\d+\.\d+$/.test(v.replace(/^v/, ""));
}

export function UpdateBanner() {
  const { t } = useTranslation(["system", "common"]);
  const { status: data, show } = useUpdateNotification();
  const features = useServerFeatures();

  const [dismissed, setDismissed] = useState(false);
  const [modal, setModal] = useState<"available" | "whatsnew" | null>(null);
  const [stepUp, setStepUp] = useState(false);
  const [upgradeToken, setUpgradeToken] = useState<string | null>(null);

  useEffect(() => {
    if (!data || !parseable(data.currentVersion)) return;
    const lastSeen = getLastSeenVersion();
    const isSignificant = data.severity === "major" || data.severity === "minor";
    if (lastSeen && lastSeen !== data.currentVersion && isSignificant) {
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
            {features.upgrade && (
              <button
                onClick={() => setStepUp(true)}
                className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-[#042f2a] hover:bg-brand/90"
              >
                {t("update.updateNow")}
              </button>
            )}
            <button
              onClick={() => setModal("available")}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
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

      <StepUpModal
        open={stepUp}
        onSuccess={(token) => {
          setStepUp(false);
          setUpgradeToken(token);
        }}
        onCancel={() => setStepUp(false)}
      />

      {upgradeToken && (
        <UpgradeModal
          stepUpToken={upgradeToken}
          targetVersion={data?.latestVersion}
          onClose={() => setUpgradeToken(null)}
        />
      )}
    </>
  );
}
