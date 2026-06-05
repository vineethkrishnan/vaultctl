// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { Download, Shield, AlertTriangle, Check } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { signIdentity } from "@/lib/key-holder";
import {
  buildSignedEnvelopeWithSigner,
  type ExportEnvelopeBody,
} from "@/shared/export";
import { getExport } from "@/api/import-export/import-export";

/**
 * Encrypted backup download. Calls the server /export endpoint (which
 * returns the already-encrypted items + metadata), wraps them in an
 * Ed25519-signed envelope using the user's identity key held inside the
 * Web Worker, and triggers a browser download.
 *
 * The resulting file is useless to anyone without the master password -
 * every item body is still encrypted with its source vault's key. The
 * envelope signature only guarantees integrity and authorship.
 */
export function ExportDialog() {
  const { t } = useTranslation(["vault", "common"]);
  const userId = useAuthStore((s) => s.userId);
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
      // The server returns the raw ExportData shape { vaults, items, folders }.
      // Coerce to the envelope body; envelope.ts handles canonicalisation.
      const payload = res.data as unknown as {
        vaults: ExportEnvelopeBody["vaults"];
        items: ExportEnvelopeBody["items"];
        folders: ExportEnvelopeBody["folders"];
      };

      const signed = await buildSignedEnvelopeWithSigner(
        {
          createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          userId,
          vaults: payload.vaults ?? [],
          items: payload.items ?? [],
          folders: payload.folders ?? [],
        },
        signIdentity,
      );

      const filename = `vaultctl-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      triggerDownload(signed, filename);
      setDone({ filename, bytes: signed.byteLength });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("vault:export.unknownError"),
      );
    } finally {
      setBusy(false);
    }
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

      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          {t("vault:export.signedNote")}
        </div>
      </div>

      <button
        onClick={handleExport}
        disabled={busy}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {busy ? t("vault:export.building") : t("vault:export.download")}
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

function triggerDownload(bytes: Uint8Array, filename: string): void {
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([buf], { type: "application/json" });
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
