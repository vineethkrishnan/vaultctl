import { useState, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { encryptData, encryptName } from "@/lib/key-holder";
import type { ItemResponse } from "@/shared/types/api";
import {
  detectFormat,
  getImporter,
  listImporters,
  type ImportFormat,
  type ParsedItem,
} from "@/shared/import";
import { Upload, FileText, Check, AlertTriangle } from "lucide-react";

const encoder = new TextEncoder();

const DEFAULT_FORMAT: ImportFormat = "bitwarden-csv";

export function ImportDialog() {
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [format, setFormat] = useState<ImportFormat>(DEFAULT_FORMAT);
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importers = listImporters();
  const activeImporter = getImporter(format);

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);

    // Try auto-detection; fall back to the currently selected format if the
    // sniff is inconclusive (user can always re-pick from the dropdown).
    let effectiveFormat = format;
    try {
      const detected = await detectFormat(file);
      if (detected) {
        effectiveFormat = detected;
        setFormat(detected);
      }
    } catch {
      // Detection is best-effort.
    }

    try {
      const items = await getImporter(effectiveFormat).parse(file);
      if (items.length === 0) {
        setError("No items found in file");
        return;
      }
      setParsedItems(items);
    } catch {
      setError("Failed to parse file");
    }
  }

  const importMutation = useMutation({
    mutationFn: async () => {
      let success = 0;
      let failed = 0;

      for (const item of parsedItems) {
        try {
          const encData = await encryptData(
            vaultId,
            encoder.encode(JSON.stringify(item.data)),
          );
          const encName = await encryptName(vaultId, item.name);
          await apiPost<ItemResponse>(`/api/v1/vaults/${vaultId}/items`, {
            itemType: item.type,
            encryptedData: encData,
            encryptedName: encName,
            favorite: false,
            reprompt: false,
          });
          success++;
        } catch {
          failed++;
        }
      }
      return { success, failed };
    },
    onSuccess: (summary) => {
      setResult(summary);
      queryClient.invalidateQueries({ queryKey: queryKeys.items.all(vaultId) });
    },
  });

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      await importMutation.mutateAsync();
    } catch {
      setError("Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Upload className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Import</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Import items from a password manager export. All data is encrypted
        client-side before being sent to the server.
      </p>

      {!parsedItems.length && !result && (
        <div className="space-y-2">
          <label htmlFor="import-format" className="text-sm font-medium">
            Format
          </label>
          <select
            id="import-format"
            value={format}
            onChange={(event) => setFormat(event.target.value as ImportFormat)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {importers.map((importer) => (
              <option key={importer.id} value={importer.id}>
                {importer.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={activeImporter.accept}
        onChange={handleFileSelect}
        className="hidden"
      />

      {!parsedItems.length && !result && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground hover:border-primary hover:text-foreground w-full justify-center"
        >
          <FileText className="h-5 w-5" />
          Select {activeImporter.label} file
        </button>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {parsedItems.length > 0 && !result && (
        <div className="space-y-3">
          <div className="rounded-md border border-border p-3 text-sm">
            <strong>{parsedItems.length}</strong> items found:
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {Object.entries(
                parsedItems.reduce<Record<string, number>>((counts, item) => {
                  counts[item.type] = (counts[item.type] ?? 0) + 1;
                  return counts;
                }, {}),
              ).map(([itemType, count]) => (
                <li key={itemType}>
                  {count} {itemType.replace("_", " ")}(s)
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleImport}
              disabled={importing}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {importing ? `Importing... (${importMutation.variables ?? 0})` : "Import All"}
            </button>
            <button
              onClick={() => setParsedItems([])}
              className="rounded-md border border-input px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-green-500" />
            <span>
              <strong>{result.success}</strong> items imported successfully
            </span>
          </div>
          {result.failed > 0 && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span>{result.failed} items failed</span>
            </div>
          )}
          <button
            onClick={() => {
              setParsedItems([]);
              setResult(null);
            }}
            className="rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Import More
          </button>
        </div>
      )}
    </div>
  );
}
