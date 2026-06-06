// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "@tanstack/react-router";
import { useAuthStore } from "@/lib/auth-store";
import { useServerFeatures } from "@/hooks/use-server-features";
import {
  LOCK_TIMEOUT_STORAGE_KEY,
  LOCK_TIMEOUT_CHANGED_EVENT,
} from "@/hooks/use-auto-lock";
import { SafetyNumber } from "@/components/vault/SafetyNumber";
import { TOTPSetup } from "@/components/auth/TOTPSetup";
import { PasswordChangeForm } from "@/components/auth/PasswordChangeForm";
import { ImportDialog } from "@/components/vault/ImportDialog";
import { ExportDialog } from "@/components/vault/ExportDialog";
import { RestoreDialog } from "@/components/vault/RestoreDialog";
import { SessionsPanel } from "@/components/settings/SessionsPanel";
import { BackupSyncPanel } from "@/components/settings/BackupSyncPanel";
import { BiometricSetting } from "@/components/settings/BiometricSetting";
import { RecoveryKitSetting } from "@/components/settings/RecoveryKitSetting";
import { AboutPanel } from "@/components/settings/AboutPanel";
import { UpdatePanel } from "@/components/settings/UpdatePanel";
import { EmailDigestSetting } from "@/components/settings/EmailDigestSetting";
import { LanguageSwitcher } from "@/components/settings/LanguageSwitcher";
import {
  Settings,
  Shield,
  Clock,
  User,
  Key,
  Check,
  Monitor,
  Database,
  Info,
} from "lucide-react";

const LOCK_OPTIONS = [
  { labelKey: "lockOptions.min1", value: 60_000 },
  { labelKey: "lockOptions.min5", value: 300_000 },
  { labelKey: "lockOptions.min15", value: 900_000 },
  { labelKey: "lockOptions.min30", value: 1_800_000 },
  { labelKey: "lockOptions.hour1", value: 3_600_000 },
  { labelKey: "lockOptions.never", value: 0 },
];

type TabId = "profile" | "security" | "sessions" | "data" | "about";

const TABS: { id: TabId; labelKey: string; icon: typeof User }[] = [
  { id: "profile", labelKey: "tabs.profile", icon: User },
  { id: "security", labelKey: "tabs.security", icon: Shield },
  { id: "sessions", labelKey: "tabs.sessions", icon: Monitor },
  { id: "data", labelKey: "tabs.data", icon: Database },
  { id: "about", labelKey: "tabs.about", icon: Info },
];

export function SettingsPage() {
  const { t } = useTranslation("settings");
  const userId = useAuthStore((s) => s.userId);
  const features = useServerFeatures();
  const identityPubKey = sessionStorage.getItem("vaultctl_id_pubkey") ?? "";

  const search = useSearch({ strict: false }) as { tab?: string };
  const initialTab: TabId = TABS.some((tabDef) => tabDef.id === search.tab)
    ? (search.tab as TabId)
    : "profile";
  const [tab, setTab] = useState<TabId>(initialTab);

  const [lockTimeout, setLockTimeout] = useState(() => {
    const stored = localStorage.getItem(LOCK_TIMEOUT_STORAGE_KEY);
    return stored ? Number(stored) : 900_000;
  });

  const [showTOTPSetup, setShowTOTPSetup] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  function handleLockTimeoutChange(value: number) {
    setLockTimeout(value);
    localStorage.setItem(LOCK_TIMEOUT_STORAGE_KEY, String(value));
    // Let the live auto-lock hook pick up the new value without a reload.
    window.dispatchEvent(new Event(LOCK_TIMEOUT_CHANGED_EVENT));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-bold">{t("title")}</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tabDef) => {
          const Icon = tabDef.icon;
          const active = tab === tabDef.id;
          return (
            <button
              key={tabDef.id}
              onClick={() => setTab(tabDef.id)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t(tabDef.labelKey)}
            </button>
          );
        })}
      </div>

      <div key={tab} className="animate-fade-up space-y-6">
        {tab === "profile" && (
          <section className="space-y-3 rounded-lg border border-border p-4">
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">{t("profile.userId")} </span>
                <span className="font-mono">{userId}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("profile.email")} </span>
                <span>{sessionStorage.getItem("vaultctl_email") ?? "-"}</span>
              </div>
            </div>
          </section>
        )}

        {tab === "profile" && features.mailer && <EmailDigestSetting />}
        {tab === "profile" && <LanguageSwitcher />}

        {tab === "security" && (
          <section className="space-y-4 rounded-lg border border-border p-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">{t("security.heading")}</h2>
            </div>

            {/* Auto-lock */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <label className="text-sm font-medium">{t("security.autoLockTimeout")}</label>
              </div>
              <select
                value={lockTimeout}
                onChange={(e) => handleLockTimeoutChange(Number(e.target.value))}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {LOCK_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            {/* TOTP */}
            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex items-center gap-2">
                <Key className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {t("security.twoFactor")}
                </span>
                {totpEnabled && (
                  <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
                    <Check className="h-3 w-3" /> {t("security.twoFactorEnabled")}
                  </span>
                )}
              </div>
              {showTOTPSetup ? (
                <TOTPSetup
                  onComplete={() => {
                    setShowTOTPSetup(false);
                    setTotpEnabled(true);
                  }}
                  onCancel={() => setShowTOTPSetup(false)}
                />
              ) : (
                <button
                  onClick={() => setShowTOTPSetup(true)}
                  disabled={totpEnabled}
                  className="rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {totpEnabled
                    ? t("security.twoFactorIsEnabled")
                    : t("security.enable2fa")}
                </button>
              )}
            </div>

            {/* Password Change */}
            <div className="space-y-2 border-t border-border pt-4">
              {showPasswordChange ? (
                <PasswordChangeForm
                  onComplete={() => {
                    setShowPasswordChange(false);
                    setPasswordChanged(true);
                  }}
                />
              ) : (
                <div>
                  <button
                    onClick={() => setShowPasswordChange(true)}
                    className="rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    {t("security.changeMasterPassword")}
                  </button>
                  {passwordChanged && (
                    <span className="ml-2 text-sm text-success">
                      {t("security.passwordChanged")}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Biometric (Touch ID) unlock */}
            <BiometricSetting />

            {/* Recovery kit (regenerate) */}
            <RecoveryKitSetting />

            {/* Safety Number */}
            {identityPubKey && (
              <div className="border-t border-border pt-4">
                <SafetyNumber identityPublicKey={identityPubKey} />
              </div>
            )}
          </section>
        )}

        {tab === "sessions" && (
          <section className="rounded-lg border border-border p-4">
            <SessionsPanel />
          </section>
        )}

        {tab === "data" && (
          <>
            <section className="rounded-lg border border-border p-4">
              <ImportDialog />
            </section>
            <section className="rounded-lg border border-border p-4">
              <ExportDialog />
            </section>
            <section className="rounded-lg border border-border p-4">
              <RestoreDialog />
            </section>
            {features.backupSync && (
              <section className="rounded-lg border border-border p-4">
                <BackupSyncPanel />
              </section>
            )}
          </>
        )}

        {tab === "about" && (
          <div className="space-y-6">
            <AboutPanel />
            {features.updates && (
              <section className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-semibold">{t("updates.heading")}</h2>
                </div>
                <UpdatePanel />
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
