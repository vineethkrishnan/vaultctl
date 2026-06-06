// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CloudUpload,
  HardDrive,
  Cloud,
  Plus,
  Trash2,
  Play,
  RotateCcw,
  Check,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { apiGet, apiPost, apiPut, apiDelete, ApiRequestError } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { postImport } from "@/api/import-export/import-export";
import { StepUpModal } from "@/components/auth/StepUpModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// ── Wire types (mirror internal/presenters/api/backup_handlers.go) ──────────
interface Destination {
  id: string;
  provider: string;
  label: string;
  frequency: string;
  retentionKeep: number;
  enabled: boolean;
  lastRunAt?: string;
  lastStatus?: string;
  nextRunAt?: string;
  createdAt: string;
}
interface Run {
  id: string;
  status: string;
  trigger: string;
  artifactName?: string;
  sizeBytes: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}
interface Artifact {
  name: string;
  size: number;
  modTime: string;
}
interface RestorePayload {
  items: {
    vaultId: string;
    itemType: string;
    encryptedData: string;
    encryptedName: string;
    folderId?: string;
  }[];
}

const KNOWN_PROVIDERS = ["local", "s3", "webdav", "gdrive", "dropbox", "onedrive"];
const FREQUENCY_VALUES = ["off", "daily", "weekly"];

function providerLabel(t: TFunction, provider: string): string {
  return KNOWN_PROVIDERS.includes(provider)
    ? t(`backup.providers.${provider}`)
    : provider;
}

function frequencyLabel(t: TFunction, frequency: string): string {
  return FREQUENCY_VALUES.includes(frequency)
    ? t(`backup.frequencies.${frequency}`)
    : frequency;
}

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === "local") return <HardDrive className="h-4 w-4 text-muted-foreground" />;
  return <Cloud className="h-4 w-4 text-muted-foreground" />;
}

const OAUTH_PROVIDERS = ["gdrive", "dropbox", "onedrive"];
const isOAuthProvider = (p: string) => OAUTH_PROVIDERS.includes(p);

type OAuthPopupOutcome =
  | { status: "connected" }
  | { status: "error"; reason: string | null }
  | { status: "closed" };

// Polls the consent popup until the provider redirects it back to our origin
// (the callback lands on /settings?backup=...), then reads the result and
// closes it. While the popup is on the provider's domain, reading its location
// throws a cross-origin error - that just means "keep waiting".
function waitForOAuthPopup(popup: Window): Promise<OAuthPopupOutcome> {
  return new Promise((resolve) => {
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer);
        resolve({ status: "closed" });
        return;
      }
      let params: URLSearchParams;
      try {
        if (popup.location.origin !== window.location.origin) return;
        params = new URLSearchParams(popup.location.search);
      } catch {
        return;
      }
      const status = params.get("backup");
      if (!status) return;
      window.clearInterval(timer);
      popup.close();
      if (status === "connected") {
        resolve({ status: "connected" });
      } else {
        resolve({ status: "error", reason: params.get("reason") });
      }
    }, 400);
  });
}

export function BackupSyncPanel() {
  const { t } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(
    () => {
      const params = new URLSearchParams(window.location.search);
      const status = params.get("backup");
      if (status === "connected")
        return { kind: "ok", text: t("backup.connected") };
      if (status === "error")
        return {
          kind: "error",
          text: t("backup.connectError", {
            reason: params.get("reason") || t("backup.reasonUnknown"),
          }),
        };
      return null;
    },
  );

  // Strip the ?backup= param the OAuth callback added so a refresh doesn't
  // re-show the banner.
  useEffect(() => {
    if (!banner) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("backup");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.toString());
  }, [banner]);

  const { data: providers } = useQuery({
    queryKey: queryKeys.backup.providers(),
    queryFn: () => apiGet<{ providers: string[] }>("/api/v1/backup/providers"),
  });

  const { data: destinations, isLoading } = useQuery({
    queryKey: queryKeys.backup.destinations(),
    queryFn: () =>
      apiGet<{ destinations: Destination[] }>("/api/v1/backup/destinations"),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.backup.destinations() });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CloudUpload className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{t("backup.title")}</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("backup.description")}
      </p>

      {banner && (
        <div
          className={`flex items-center gap-2 rounded-md p-2 text-sm ${
            banner.kind === "ok"
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {banner.kind === "ok" ? (
            <Check className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          {banner.text}
          <button
            onClick={() => setBanner(null)}
            className="ml-auto text-xs underline opacity-70 hover:opacity-100"
          >
            {t("common:actions.dismiss")}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("backup.loadingDestinations")}
        </div>
      ) : (
        <div className="space-y-3">
          {(destinations?.destinations ?? []).map((dest) => (
            <DestinationCard key={dest.id} dest={dest} onChange={invalidate} />
          ))}
          {(destinations?.destinations ?? []).length === 0 && !adding && (
            <p className="text-sm text-muted-foreground">
              {t("backup.noDestinations")}
            </p>
          )}
        </div>
      )}

      {adding ? (
        <DestinationForm
          providers={providers?.providers ?? ["local"]}
          onDone={() => {
            setAdding(false);
            invalidate();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          {t("backup.addDestination")}
        </button>
      )}
    </div>
  );
}

// ── A single destination, with run-now / restore / delete ───────────────────
function DestinationCard({
  dest,
  onChange,
}: {
  dest: Destination;
  onChange: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const runNow = useMutation({
    mutationFn: () =>
      apiPost<Run>(`/api/v1/backup/destinations/${dest.id}/run`),
    onSuccess: (run) => {
      if (run.status === "failed") {
        setError(run.error || t("backup.backupFailed"));
      } else {
        setError(null);
      }
      onChange();
      queryClient.invalidateQueries({ queryKey: queryKeys.backup.runs(dest.id) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.backup.artifacts(dest.id),
      });
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : t("backup.backupFailed")),
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/v1/backup/destinations/${dest.id}`),
    onSuccess: onChange,
  });

  if (editing) {
    return (
      <DestinationForm
        providers={[dest.provider]}
        existing={dest}
        onDone={() => {
          setEditing(false);
          onChange();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ProviderIcon provider={dest.provider} />
            <span className="truncate">{dest.label}</span>
            {!dest.enabled && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {t("backup.paused")}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {providerLabel(t, dest.provider)} ·{" "}
            {frequencyLabel(t, dest.frequency)}{" "}
            · {t("backup.keep", { count: dest.retentionKeep })}
          </div>
          <div className="text-xs text-muted-foreground">
            {dest.lastRunAt ? (
              <>
                {t("backup.lastBackup", {
                  when: new Date(dest.lastRunAt).toLocaleString(),
                })}{" "}
                {dest.lastStatus === "success" ? (
                  <span className="text-success">{t("backup.statusOk")}</span>
                ) : (
                  <span className="text-destructive">{t("backup.statusFailed")}</span>
                )}
              </>
            ) : (
              t("backup.neverRun")
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
            title={t("backup.backUpNow")}
            className="rounded-md border border-input p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {runNow.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => setEditing(true)}
            title={t("backup.edit")}
            className="rounded-md border border-input px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("backup.edit")}
          </button>
          <button
            onClick={() => setConfirmingDelete(true)}
            disabled={remove.isPending}
            title={t("backup.deleteDestination")}
            className="rounded-md border border-input p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title={t("backup.deleteConfirm.title")}
        message={t("backup.deleteConfirm.message", { label: dest.label })}
        confirmLabel={t("common:actions.delete")}
        destructive
        busy={remove.isPending}
        onConfirm={() => {
          setConfirmingDelete(false);
          remove.mutate();
        }}
        onCancel={() => setConfirmingDelete(false)}
      />

      {dest.provider === "local" && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>{t("backup.localWarning")}</span>
        </div>
      )}

      {error && (
        <div className="mt-2 flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        {t("backup.backupsAndRestore")}
      </button>
      {expanded && <DestinationDetail destinationId={dest.id} />}
    </div>
  );
}

// ── Run history + artifact list with restore ────────────────────────────────
function DestinationDetail({ destinationId }: { destinationId: string }) {
  const { t } = useTranslation("settings");
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const [restoreState, setRestoreState] = useState<{
    busy: boolean;
    message: string | null;
    error: string | null;
  }>({ busy: false, message: null, error: null });

  const { data: artifacts } = useQuery({
    queryKey: queryKeys.backup.artifacts(destinationId),
    queryFn: () =>
      apiGet<{ artifacts: Artifact[] }>(
        `/api/v1/backup/destinations/${destinationId}/artifacts`,
      ),
  });
  const { data: runs } = useQuery({
    queryKey: queryKeys.backup.runs(destinationId),
    queryFn: () =>
      apiGet<{ runs: Run[] }>(
        `/api/v1/backup/destinations/${destinationId}/runs`,
      ),
  });

  async function restore(name: string) {
    setRestoreState({ busy: true, message: null, error: null });
    try {
      const payload = await apiGet<RestorePayload>(
        `/api/v1/backup/destinations/${destinationId}/restore?name=${encodeURIComponent(name)}`,
      );
      // Items keep their original vault ciphertext; re-import per source vault.
      const byVault = new Map<string, RestorePayload["items"]>();
      for (const it of payload.items ?? []) {
        const arr = byVault.get(it.vaultId);
        if (arr) arr.push(it);
        else byVault.set(it.vaultId, [it]);
      }
      let restored = 0;
      const failures: string[] = [];
      for (const [vaultId, group] of byVault) {
        try {
          const res = await postImport({
            vaultId,
            items: group.map((it) => ({
              itemType: it.itemType,
              encryptedData: it.encryptedData,
              encryptedName: it.encryptedName,
              folderId: it.folderId,
            })),
          });
          if (res.status === 200 && res.data) {
            restored += res.data.importedCount ?? group.length;
          } else {
            failures.push(
              t("backup.vaultHttpError", {
                id: vaultId.slice(0, 8),
                status: res.status,
              }),
            );
          }
        } catch (err) {
          failures.push(
            t("backup.vaultError", {
              id: vaultId.slice(0, 8),
              message: err instanceof Error ? err.message : t("backup.errorWord"),
            }),
          );
        }
      }
      setRestoreState({
        busy: false,
        message: t("backup.restored", {
          count: restored,
          skipped: failures.length
            ? t("backup.skippedVaults", { count: failures.length })
            : "",
        }),
        error: failures.length ? failures.join("; ") : null,
      });
    } catch (err) {
      if (err instanceof ApiRequestError && err.error.code === "STEP_UP_REQUIRED") {
        setPendingRestore(name);
        setStepUpOpen(true);
        setRestoreState({ busy: false, message: null, error: null });
        return;
      }
      setRestoreState({
        busy: false,
        message: null,
        error: err instanceof Error ? err.message : t("backup.restoreFailed"),
      });
    }
  }

  return (
    <div className="mt-2 space-y-3 border-t border-border pt-2">
      {restoreState.message && (
        <div className="flex items-center gap-2 text-xs text-success">
          <Check className="h-3.5 w-3.5" /> {restoreState.message}
        </div>
      )}
      {restoreState.error && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {restoreState.error}
        </div>
      )}

      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t("backup.storedBackups")}
        </div>
        {(artifacts?.artifacts ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("backup.noStoredBackups")}</p>
        ) : (
          <ul className="space-y-1">
            {(artifacts?.artifacts ?? []).map((a) => (
              <li
                key={a.name}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
              >
                <span className="min-w-0">
                  <span className="block truncate">{a.name}</span>
                  <span className="text-muted-foreground">
                    {new Date(a.modTime).toLocaleString()} · {formatBytes(a.size)}
                  </span>
                </span>
                <button
                  onClick={() => restore(a.name)}
                  disabled={restoreState.busy}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-input px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {restoreState.busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  {t("backup.restore")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(runs?.runs ?? []).length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            {t("backup.recentRuns")}
          </div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {(runs?.runs ?? []).slice(0, 5).map((run) => (
              <li key={run.id} className="flex items-center gap-2">
                {run.status === "success" ? (
                  <Check className="h-3 w-3 text-success" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-destructive" />
                )}
                <span>{new Date(run.startedAt).toLocaleString()}</span>
                <span>· {run.trigger}</span>
                {run.error && <span className="text-destructive">· {run.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <StepUpModal
        open={stepUpOpen}
        onSuccess={() => {
          setStepUpOpen(false);
          if (pendingRestore) {
            const name = pendingRestore;
            setPendingRestore(null);
            void restore(name);
          }
        }}
        onCancel={() => {
          setStepUpOpen(false);
          setPendingRestore(null);
        }}
      />
    </div>
  );
}

// ── Create / edit form ───────────────────────────────────────────────────────
function DestinationForm({
  providers,
  existing,
  onDone,
  onCancel,
}: {
  providers: string[];
  existing?: Destination;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const [provider, setProvider] = useState(existing?.provider ?? providers[0] ?? "local");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [frequency, setFrequency] = useState(existing?.frequency ?? "daily");
  const [retentionKeep, setRetentionKeep] = useState(existing?.retentionKeep ?? 7);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const set = (k: string, v: string) => setSettings((s) => ({ ...s, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      // Only send provided settings; on edit, omitted secrets keep their
      // stored values server-side.
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(settings)) if (v.trim()) clean[k] = v.trim();
      const body = { provider, label, frequency, retentionKeep, enabled, settings: clean };
      return existing
        ? apiPut(`/api/v1/backup/destinations/${existing.id}`, body)
        : apiPost("/api/v1/backup/destinations", body);
    },
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof Error ? err.message : t("backup.saveFailed")),
  });

  async function connect() {
    setError(null);
    setConnecting(true);
    try {
      const res = await apiPost<{ authUrl: string }>(
        `/api/v1/backup/oauth/${provider}/start`,
      );
      // Run the consent in a popup so this tab never unloads - a full-page
      // redirect would drop the in-memory session and vault keys and force a
      // re-login after every connect. Fall back to the redirect only when the
      // popup is blocked.
      const popup = window.open(res.authUrl, "vaultctl-oauth", "popup,width=540,height=700");
      if (!popup) {
        window.location.href = res.authUrl;
        return;
      }
      const outcome = await waitForOAuthPopup(popup);
      setConnecting(false);
      if (outcome.status === "connected") {
        onDone();
      } else if (outcome.status === "error") {
        setError(t("backup.connectError", { reason: outcome.reason || t("backup.reasonUnknown") }));
      }
      // "closed" (user dismissed the popup) ends the spinner without an error.
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : t("backup.connectStartFailed"));
    }
  }

  // OAuth providers are connected via a consent redirect, not the credential
  // form; the callback creates the destination server-side.
  if (!existing && isOAuthProvider(provider)) {
    return (
      <div className="space-y-3 rounded-md border border-border p-3">
        <div className="text-sm font-medium">{t("backup.connectCloud")}</div>
        {error && (
          <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">{t("backup.provider")}</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            {providers.map((p) => (
              <option key={p} value={p}>
                {providerLabel(t, p)}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          {t("backup.connectIntro", { provider: providerLabel(t, provider) })}
        </p>
        <div className="flex gap-2">
          <button
            onClick={connect}
            disabled={connecting}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            {t("backup.connectProvider", { provider: providerLabel(t, provider) })}
          </button>
          <button
            onClick={onCancel}
            className="rounded-md border border-input px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            {t("common:actions.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="text-sm font-medium">
        {existing ? t("backup.editDestination") : t("backup.newDestination")}
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">{t("backup.provider")}</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={!!existing}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
          >
            {providers.map((p) => (
              <option key={p} value={p}>
                {providerLabel(t, p)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">{t("backup.label")}</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("backup.labelPlaceholder")}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">{t("backup.frequency")}</span>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            {FREQUENCY_VALUES.map((value) => (
              <option key={value} value={value}>
                {frequencyLabel(t, value)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">{t("backup.keepLastN")}</span>
          <input
            type="number"
            min={1}
            value={retentionKeep}
            onChange={(e) => setRetentionKeep(Math.max(1, Number(e.target.value)))}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </label>
        {provider === "local" && (
          <p className="col-span-2 text-[11px] text-muted-foreground">
            {t("backup.localStored")}
          </p>
        )}
        {provider === "webdav" && (
          <>
            <label className="col-span-2 space-y-1 text-xs">
              <span className="text-muted-foreground">{t("backup.webdavUrl")}</span>
              <input
                value={settings.url ?? ""}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://cloud.example.com/remote.php/dav/files/me/vaultctl"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("backup.username")}</span>
              <input
                value={settings.username ?? ""}
                onChange={(e) => set("username", e.target.value)}
                autoComplete="off"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">
                {t("backup.password")} {existing && t("backup.passwordKeepHint")}
              </span>
              <input
                type="password"
                value={settings.password ?? ""}
                onChange={(e) => set("password", e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
          </>
        )}
        {provider === "s3" && (
          <>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("backup.endpoint")}</span>
              <input
                value={settings.endpoint ?? ""}
                onChange={(e) => set("endpoint", e.target.value)}
                placeholder="https://s3.us-east-1.amazonaws.com"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("backup.region")}</span>
              <input
                value={settings.region ?? ""}
                onChange={(e) => set("region", e.target.value)}
                placeholder="us-east-1"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("backup.bucket")}</span>
              <input
                value={settings.bucket ?? ""}
                onChange={(e) => set("bucket", e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("backup.prefixOptional")}</span>
              <input
                value={settings.prefix ?? ""}
                onChange={(e) => set("prefix", e.target.value)}
                placeholder="vaultctl/"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("backup.accessKey")}</span>
              <input
                value={settings.accessKey ?? ""}
                onChange={(e) => set("accessKey", e.target.value)}
                autoComplete="off"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">
                {t("backup.secretKey")} {existing && t("backup.passwordKeepHint")}
              </span>
              <input
                type="password"
                value={settings.secretKey ?? ""}
                onChange={(e) => set("secretKey", e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
          </>
        )}
        <label className="col-span-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-brand"
          />
          <span>{t("backup.enabledLabel")}</span>
        </label>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || !label.trim()}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {save.isPending
            ? t("backup.saving")
            : existing
              ? t("common:actions.save")
              : t("backup.add")}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-input px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          {t("common:actions.cancel")}
        </button>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
