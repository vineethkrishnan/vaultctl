// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useAuthStore } from "@/lib/auth-store";
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
  { label: "1 minute", value: 60_000 },
  { label: "5 minutes", value: 300_000 },
  { label: "15 minutes", value: 900_000 },
  { label: "30 minutes", value: 1_800_000 },
  { label: "1 hour", value: 3_600_000 },
  { label: "Never", value: 0 },
];

type TabId = "profile" | "security" | "sessions" | "data" | "about";

const TABS: { id: TabId; label: string; icon: typeof User }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "security", label: "Security", icon: Shield },
  { id: "sessions", label: "Sessions", icon: Monitor },
  { id: "data", label: "Data", icon: Database },
  { id: "about", label: "About", icon: Info },
];

export function SettingsPage() {
  const userId = useAuthStore((s) => s.userId);
  const identityPubKey = sessionStorage.getItem("vaultctl_id_pubkey") ?? "";

  const [tab, setTab] = useState<TabId>("profile");

  const [lockTimeout, setLockTimeout] = useState(() => {
    const stored = localStorage.getItem("vaultctl_lock_timeout");
    return stored ? Number(stored) : 900_000;
  });

  const [showTOTPSetup, setShowTOTPSetup] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  function handleLockTimeoutChange(value: number) {
    setLockTimeout(value);
    localStorage.setItem("vaultctl_lock_timeout", String(value));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div key={tab} className="animate-fade-up space-y-6">
        {tab === "profile" && (
          <section className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">Profile</h2>
            </div>
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">User ID: </span>
                <span className="font-mono">{userId}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Email: </span>
                <span>{sessionStorage.getItem("vaultctl_email") ?? "—"}</span>
              </div>
            </div>
          </section>
        )}

        {tab === "security" && (
          <section className="space-y-4 rounded-lg border border-border p-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">Security</h2>
            </div>

            {/* Auto-lock */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <label className="text-sm font-medium">Auto-lock timeout</label>
              </div>
              <select
                value={lockTimeout}
                onChange={(e) => handleLockTimeoutChange(Number(e.target.value))}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {LOCK_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* TOTP */}
            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex items-center gap-2">
                <Key className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">
                  Two-Factor Authentication
                </span>
                {totpEnabled && (
                  <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-500">
                    <Check className="h-3 w-3" /> Enabled
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
                  {totpEnabled ? "2FA is enabled" : "Enable 2FA"}
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
                    Change Master Password
                  </button>
                  {passwordChanged && (
                    <span className="ml-2 text-sm text-green-500">
                      Password changed
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
            <section className="rounded-lg border border-border p-4">
              <BackupSyncPanel />
            </section>
          </>
        )}

        {tab === "about" && <AboutPanel />}
      </div>
    </div>
  );
}
