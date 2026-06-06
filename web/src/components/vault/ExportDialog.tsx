// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { Download, Shield, AlertTriangle, Check } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { signIdentity, decryptData, decryptName } from "@/lib/key-holder";
import {
  buildSignedEnvelopeWithSigner,
  type ExportEnvelopeBody,
} from "@/shared/export";
import { itemsToCsv, type CsvExportItem } from "@/shared/export/csv";
import { getExport } from "@/api/import-export/import-export";

type ExportFormat = "json" | "csv";

const decoder = new TextDecoder();

interface ExportPayload {
  vaults: ExportEnvelopeBody["vaults"];
  items: ExportEnvelopeBody["items"];
  folders: ExportEnvelopeBody["folders"];
}

/**
 * Backup download. JSON produces an Ed25519-signed envelope of the
 * still-encrypted items (useless without the master password). CSV decrypts
 * every item in the browser and writes a plaintext file for portability to
 * other managers - never encrypted, and the plaintext never leaves the client.
 */
export function ExportDialog() {
  const { t } = useTranslation(["vault", "common"]);
  const userId = useAuthStore((s) => s.userId);
  const [format, setFormat] = useState<ExportFormat>("json");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ filename: string; bytes: number } | null>(
    null,
  );

  async function handleExport() {
    setError(null);
    setDone(null);

    if (!userId) {
      setError(t("vault:export.notSignedIn"));
      return;
    }

    setBusy(true);
    try {
      const res = await getExport();
      if (res.status !== 200) {
        setError(t("vault:export.serverReturned", { status: res.status }));
        return;
      }
      const payload = res.data as unknown as ExportPayload;

      const result =
        format === "csv"
          ? await buildCsv(payload)
          : await buildJson(payload, userId);

      triggerDownload(result.bytes, result.filename, result.mime);
      setDone({ filename: result.filename, bytes: result.bytes.byteLength });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("vault:export.unknownError"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function buildJson(payload: ExportPayload, signerUserId: string) {
    const signed = await buildSignedEnvelopeWithSigner(
      {
        createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        userId: signerUserId,
        vaults: payload.vaults ?? [],
        items: payload.items ?? [],
        folders: payload.folders ?? [],
      },
      signIdentity,
    );
    return {
      bytes: signed,
      filename: `vaultctl-backup-${new Date().toISOString().slice(0, 10)}.json`,
      mime: "application/json",
    };
  }

  async function buildCsv(payload: ExportPayload) {
    const rows = await decryptToCsvItems(payload);
    if (rows.length === 0) throw new Error(t("vault:export.noItems"));
    const bytes = new TextEncoder().encode(itemsToCsv(rows));
    return {
      bytes,
      filename: `vaultctl-export-${new Date().toISOString().slice(0, 10)}.csv`,
      mime: "text/csv",
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Download className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{t("vault:export.heading")}</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("vault:export.description")}
      </p>

      <div className="space-y-1.5">
        <label
          htmlFor="export-format"
          className="text-sm font-medium text-foreground"
        >
          {t("vault:export.format")}
        </label>
        <select
          id="export-format"
          value={format}
          onChange={(e) => {
            setFormat(e.target.value as ExportFormat);
            setDone(null);
            setError(null);
          }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2 sm:w-72"
        >
          <option value="json">{t("vault:export.formatJson")}</option>
          <option value="csv">{t("vault:export.formatCsv")}</option>
        </select>
      </div>

      {format === "json" ? (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{t("vault:export.signedNote")}</div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{t("vault:export.csvWarning")}</div>
        </div>
      )}

      <button
        onClick={handleExport}
        disabled={busy}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {busy
          ? t("vault:export.building")
          : format === "csv"
            ? t("vault:export.downloadCsv")
            : t("vault:export.download")}
      </button>

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {done && (
        <div className="flex items-center gap-2 text-sm text-green-500">
          <Check className="h-4 w-4" />
          <span>
            <Trans
              t={t}
              i18nKey="vault:export.savedFile"
              values={{ filename: done.filename, size: formatBytes(done.bytes) }}
              components={{ 1: <strong /> }}
            />
          </span>
        </div>
      )}
    </div>
  );
}

async function decryptToCsvItems(
  payload: ExportPayload,
): Promise<CsvExportItem[]> {
  const folderNames = new Map<string, string>();
  for (const folder of payload.folders ?? []) {
    try {
      folderNames.set(
        folder.id,
        await decryptName(folder.vaultId, folder.encryptedName),
      );
    } catch {
      // Skip folders we cannot decrypt; their items just get an empty folder.
    }
  }

  const rows: CsvExportItem[] = [];
  for (const item of payload.items ?? []) {
    let name = "";
    try {
      name = await decryptName(item.vaultId, item.encryptedName);
    } catch {
      continue;
    }

    let fields: Record<string, unknown> = {};
    try {
      fields = JSON.parse(
        decoder.decode(await decryptData(item.vaultId, item.encryptedData)),
      ) as Record<string, unknown>;
    } catch {
      // Keep the row with just its name if the body fails to decrypt.
    }

    rows.push({
      name,
      username: pickString(fields, "username"),
      password: pickString(fields, "password"),
      uri: pickString(fields, "uri"),
      notes: pickString(fields, "notes"),
      folder: item.folderId ? (folderNames.get(item.folderId) ?? "") : "",
      type: item.itemType,
    });
  }
  return rows;
}

function pickString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function triggerDownload(
  bytes: Uint8Array,
  filename: string,
  mime: string,
): void {
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([buf], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
