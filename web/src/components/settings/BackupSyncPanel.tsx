// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect } from "react";
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

const PROVIDER_LABELS: Record<string, string> = {
  local: "Local disk",
  s3: "S3-compatible",
  webdav: "WebDAV",
  gdrive: "Google Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
};

const FREQUENCIES = [
  { value: "off", label: "Manual only" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === "local") return <HardDrive className="h-4 w-4 text-muted-foreground" />;
  return <Cloud className="h-4 w-4 text-muted-foreground" />;
}

const OAUTH_PROVIDERS = ["gdrive", "dropbox", "onedrive"];
const isOAuthProvider = (p: string) => OAUTH_PROVIDERS.includes(p);

export function BackupSyncPanel() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(
    () => {
      const params = new URLSearchParams(window.location.search);
      const status = params.get("backup");
      if (status === "connected") return { kind: "ok", text: "Cloud account connected" };
      if (status === "error")
        return {
          kind: "error",
          text: `Could not connect (${params.get("reason") || "unknown"})`,
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
        <h2 className="text-lg font-semibold">Backup &amp; Sync</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Schedule automatic, encrypted backups of your vaults to a destination of
        your choice. Backups carry only ciphertext — they are useless without
        your master password — and run on the server even when this app is
        closed.
      </p>

      {banner && (
        <div
          className={`flex items-center gap-2 rounded-md p-2 text-sm ${
            banner.kind === "ok"
              ? "bg-green-500/10 text-green-500"
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
            dismiss
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading destinations…
        </div>
      ) : (
        <div className="space-y-3">
          {(destinations?.destinations ?? []).map((dest) => (
            <DestinationCard key={dest.id} dest={dest} onChange={invalidate} />
          ))}
          {(destinations?.destinations ?? []).length === 0 && !adding && (
            <p className="text-sm text-muted-foreground">
              No backup destinations yet.
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
          Add destination
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
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runNow = useMutation({
    mutationFn: () =>
      apiPost<Run>(`/api/v1/backup/destinations/${dest.id}/run`),
    onSuccess: (run) => {
      if (run.status === "failed") {
        setError(run.error || "Backup failed");
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
      setError(err instanceof Error ? err.message : "Backup failed"),
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
                paused
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {PROVIDER_LABELS[dest.provider] ?? dest.provider} ·{" "}
            {FREQUENCIES.find((f) => f.value === dest.frequency)?.label ??
              dest.frequency}{" "}
            · keep {dest.retentionKeep}
          </div>
          <div className="text-xs text-muted-foreground">
            {dest.lastRunAt ? (
              <>
                Last backup {new Date(dest.lastRunAt).toLocaleString()}{" "}
                {dest.lastStatus === "success" ? (
                  <span className="text-green-500">· ok</span>
                ) : (
                  <span className="text-destructive">· failed</span>
                )}
              </>
            ) : (
              "Never run yet"
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
            title="Back up now"
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
            title="Edit"
            className="rounded-md border border-input px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Edit
          </button>
          <button
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            title="Delete destination"
            className="rounded-md border border-input p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {dest.provider === "local" && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>
            A local copy lives on the server's disk. A disk failure loses it —
            pair it with an off-box destination for real durability.
          </span>
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
        Backups &amp; restore
      </button>
      {expanded && <DestinationDetail destinationId={dest.id} />}
    </div>
  );
}

// ── Run history + artifact list with restore ────────────────────────────────
function DestinationDetail({ destinationId }: { destinationId: string }) {
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
            failures.push(`vault ${vaultId.slice(0, 8)}: HTTP ${res.status}`);
          }
        } catch (err) {
          failures.push(
            `vault ${vaultId.slice(0, 8)}: ${err instanceof Error ? err.message : "error"}`,
          );
        }
      }
      setRestoreState({
        busy: false,
        message: `Restored ${restored} item(s)${failures.length ? `, ${failures.length} vault(s) skipped` : ""}`,
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
        error: err instanceof Error ? err.message : "Restore failed",
      });
    }
  }

  return (
    <div className="mt-2 space-y-3 border-t border-border pt-2">
      {restoreState.message && (
        <div className="flex items-center gap-2 text-xs text-green-500">
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
          Stored backups
        </div>
        {(artifacts?.artifacts ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No backups stored yet.</p>
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
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(runs?.runs ?? []).length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Recent runs
          </div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {(runs?.runs ?? []).slice(0, 5).map((run) => (
              <li key={run.id} className="flex items-center gap-2">
                {run.status === "success" ? (
                  <Check className="h-3 w-3 text-green-500" />
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
      setError(err instanceof Error ? err.message : "Could not save destination"),
  });

  async function connect() {
    setError(null);
    setConnecting(true);
    try {
      const res = await apiPost<{ authUrl: string }>(
        `/api/v1/backup/oauth/${provider}/start`,
      );
      window.location.href = res.authUrl;
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : "Could not start the connection");
    }
  }

  // OAuth providers are connected via a consent redirect, not the credential
  // form; the callback creates the destination server-side.
  if (!existing && isOAuthProvider(provider)) {
    return (
      <div className="space-y-3 rounded-md border border-border p-3">
        <div className="text-sm font-medium">Connect a cloud account</div>
        {error && (
          <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            {providers.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p] ?? p}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          You'll be sent to {PROVIDER_LABELS[provider]} to authorize access to an
          app-private folder. After connecting, set the schedule here.
        </p>
        <div className="flex gap-2">
          <button
            onClick={connect}
            disabled={connecting}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            Connect {PROVIDER_LABELS[provider]}
          </button>
          <button
            onClick={onCancel}
            className="rounded-md border border-input px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="text-sm font-medium">
        {existing ? "Edit destination" : "New destination"}
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={!!existing}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
          >
            {providers.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p] ?? p}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My backups"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Frequency</span>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Keep last N</span>
          <input
            type="number"
            min={1}
            value={retentionKeep}
            onChange={(e) => setRetentionKeep(Math.max(1, Number(e.target.value)))}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </label>
        {provider === "local" && (
          <label className="col-span-2 space-y-1 text-xs">
            <span className="text-muted-foreground">
              Directory (optional — server-side path)
            </span>
            <input
              value={settings.dir ?? ""}
              onChange={(e) => set("dir", e.target.value)}
              placeholder="Defaults to the server backup directory"
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
        )}
        {provider === "webdav" && (
          <>
            <label className="col-span-2 space-y-1 text-xs">
              <span className="text-muted-foreground">WebDAV collection URL</span>
              <input
                value={settings.url ?? ""}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://cloud.example.com/remote.php/dav/files/me/vaultctl"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Username</span>
              <input
                value={settings.username ?? ""}
                onChange={(e) => set("username", e.target.value)}
                autoComplete="off"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">
                Password {existing && "(leave blank to keep)"}
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
              <span className="text-muted-foreground">Endpoint</span>
              <input
                value={settings.endpoint ?? ""}
                onChange={(e) => set("endpoint", e.target.value)}
                placeholder="https://s3.us-east-1.amazonaws.com"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Region</span>
              <input
                value={settings.region ?? ""}
                onChange={(e) => set("region", e.target.value)}
                placeholder="us-east-1"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Bucket</span>
              <input
                value={settings.bucket ?? ""}
                onChange={(e) => set("bucket", e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Prefix (optional)</span>
              <input
                value={settings.prefix ?? ""}
                onChange={(e) => set("prefix", e.target.value)}
                placeholder="vaultctl/"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Access key</span>
              <input
                value={settings.accessKey ?? ""}
                onChange={(e) => set("accessKey", e.target.value)}
                autoComplete="off"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">
                Secret key {existing && "(leave blank to keep)"}
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
          <span>Enabled (run on the configured schedule)</span>
        </label>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || !label.trim()}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : existing ? "Save" : "Add"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-input px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
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
