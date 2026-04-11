import { useRef, useState } from "react";
import { Upload, FileText, Check, AlertTriangle, Shield } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { fromBase64 } from "@/shared/crypto";
import {
  verifyEnvelope,
  EnvelopeError,
  EnvelopeSignatureError,
  EnvelopeUserMismatchError,
  EnvelopeVersionError,
  type ExportEnvelopeBody,
  type ExportEnvelopeItem,
} from "@/shared/export";
import { postImport } from "@/api/import-export/import-export";

/**
 * Restore from a vaultctl native encrypted backup (as produced by
 * ExportDialog). The flow is fundamentally different from foreign-format
 * imports:
 *
 *   foreign CSV/1PUX/XML  →  plaintext  →  client encrypts  →  /import
 *   vaultctl envelope     →  already-encrypted blobs  →  verify + passthrough
 *
 * The envelope items carry vault-level ciphertext that was sealed with
 * whichever vault's key they came from. They MUST be re-imported to the
 * SAME vault ID to decrypt later — the /import endpoint itself enforces
 * this by taking a vaultId and binding items to it.
 *
 * In the interest of not re-inventing cross-vault key management in this
 * first pass, the dialog groups items by their source vaultId and issues
 * one POST /import per group. Vaults that no longer exist on this account
 * return 404 and are surfaced as per-group failures.
 */
export function RestoreDialog() {
  const userId = useAuthStore((s) => s.userId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [verified, setVerified] = useState<ExportEnvelopeBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState<{
    restoredByVault: Record<string, number>;
    failedByVault: Record<string, string>;
  } | null>(null);

  async function handleFileSelect(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);
    setVerified(null);

    if (!userId) {
      setError("Not signed in");
      return;
    }

    const identityPubB64 = sessionStorage.getItem("vaultctl_id_pubkey");
    if (!identityPubB64) {
      setError("Identity public key unavailable — sign in again and retry");
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setError("Could not read the selected file");
      return;
    }

    try {
      const body = await verifyEnvelope(
        bytes,
        userId,
        fromBase64(identityPubB64),
      );
      setVerified(body);
    } catch (err) {
      setError(describeEnvelopeError(err));
    }
  }

  async function handleRestore() {
    if (!verified) return;
    setRestoring(true);
    setError(null);

    const grouped = groupByVault(verified.items);
    const restoredByVault: Record<string, number> = {};
    const failedByVault: Record<string, string> = {};

    for (const [vaultId, group] of grouped) {
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
          restoredByVault[vaultId] = res.data.importedCount ?? group.length;
        } else {
          failedByVault[vaultId] = `server returned ${res.status}`;
        }
      } catch (err) {
        failedByVault[vaultId] =
          err instanceof Error ? err.message : "unknown error";
      }
    }

    setResult({ restoredByVault, failedByVault });
    setRestoring(false);
  }

  function reset() {
    setVerified(null);
    setResult(null);
    setError(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Upload className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Restore encrypted backup</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Upload a vaultctl encrypted backup file (from the Export section
        above). Signature is verified against your identity key before any
        data is sent to the server. Items are restored into their original
        vaults — vaults that no longer exist on this account are skipped.
      </p>

      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          Tampered, cross-account, or foreign-format files are rejected
          before any network call.
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileSelect}
        className="hidden"
      />

      {!verified && !result && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
        >
          <FileText className="h-4 w-4" />
          Select backup file
        </button>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {verified && !result && (
        <div className="space-y-3">
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-center gap-2 text-green-500">
              <Check className="h-4 w-4" />
              <span className="font-medium">Signature verified</span>
            </div>
            <ul className="mt-2 space-y-0.5 text-muted-foreground">
              <li>Created: {verified.createdAt}</li>
              <li>{verified.items.length} items across {countVaults(verified.items)} vaults</li>
              <li>{verified.folders.length} folders</li>
            </ul>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleRestore}
              disabled={restoring}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {restoring ? "Restoring…" : "Restore"}
            </button>
            <button
              onClick={reset}
              className="rounded-md border border-input px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          {Object.entries(result.restoredByVault).map(([vaultId, count]) => (
            <div
              key={vaultId}
              className="flex items-center gap-2 text-sm text-green-500"
            >
              <Check className="h-4 w-4" />
              <span>
                Vault <code className="font-mono">{short(vaultId)}</code>:{" "}
                <strong>{count}</strong> items restored
              </span>
            </div>
          ))}
          {Object.entries(result.failedByVault).map(([vaultId, reason]) => (
            <div
              key={vaultId}
              className="flex items-start gap-2 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Vault <code className="font-mono">{short(vaultId)}</code>:{" "}
                {reason}
              </span>
            </div>
          ))}
          <button
            onClick={reset}
            className="rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Restore another
          </button>
        </div>
      )}
    </div>
  );
}

function groupByVault(
  items: ExportEnvelopeItem[],
): Map<string, ExportEnvelopeItem[]> {
  const out = new Map<string, ExportEnvelopeItem[]>();
  for (const it of items) {
    const arr = out.get(it.vaultId);
    if (arr) arr.push(it);
    else out.set(it.vaultId, [it]);
  }
  return out;
}

function countVaults(items: ExportEnvelopeItem[]): number {
  return new Set(items.map((it) => it.vaultId)).size;
}

function short(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`;
}

function describeEnvelopeError(err: unknown): string {
  if (err instanceof EnvelopeSignatureError) {
    return "Signature verification failed — the file was modified or corrupted. Do NOT trust its contents.";
  }
  if (err instanceof EnvelopeUserMismatchError) {
    return "This backup belongs to a different account and cannot be restored here.";
  }
  if (err instanceof EnvelopeVersionError) {
    return `${err.message}. Upgrade vaultctl to a newer version.`;
  }
  if (err instanceof EnvelopeError) {
    return err.message;
  }
  return err instanceof Error ? err.message : "Unknown error";
}
