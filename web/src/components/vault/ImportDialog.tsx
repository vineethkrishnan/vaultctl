import { useState, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { encryptData, encryptName } from "@/lib/key-holder";
import type { ItemResponse } from "@/shared/types/api";
import { Upload, FileText, Check, AlertTriangle } from "lucide-react";

const encoder = new TextEncoder();

interface ParsedItem {
  name: string;
  type: string;
  data: Record<string, unknown>;
}

/**
 * Parse Bitwarden CSV export format.
 *
 * Bitwarden CSV columns:
 * folder, favorite, type, name, notes, fields, reprompt,
 * login_uri, login_username, login_password, login_totp
 */
function parseBitwardenCSV(csv: string): ParsedItem[] {
  const lines = csv.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVRow(lines[0]!);
  const items: ParsedItem[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim().toLowerCase()] = cols[idx] ?? "";
    });

    const bwType = (row["type"] ?? "").toLowerCase();
    const name = row["name"] ?? "Untitled";

    if (bwType === "login" || bwType === "1") {
      items.push({
        name,
        type: "login",
        data: {
          username: row["login_username"] ?? "",
          password: row["login_password"] ?? "",
          uri: row["login_uri"] ?? "",
          totp: row["login_totp"] ?? "",
          notes: row["notes"] ?? "",
          customFields: [],
        },
      });
    } else if (bwType === "note" || bwType === "securenote" || bwType === "2") {
      items.push({
        name,
        type: "secure_note",
        data: {
          content: row["notes"] ?? "",
          notes: "",
          customFields: [],
        },
      });
    } else if (bwType === "card" || bwType === "3") {
      items.push({
        name,
        type: "credit_card",
        data: {
          cardholderName: row["card_cardholdername"] ?? "",
          number: row["card_number"] ?? "",
          expiry: row["card_expmonth"] && row["card_expyear"]
            ? `${row["card_expmonth"]}/${row["card_expyear"]?.slice(-2)}`
            : "",
          cvv: row["card_code"] ?? "",
          cardType: row["card_brand"] ?? "",
          notes: row["notes"] ?? "",
          customFields: [],
        },
      });
    } else if (bwType === "identity" || bwType === "4") {
      items.push({
        name,
        type: "identity",
        data: {
          firstName: row["identity_firstname"] ?? "",
          lastName: row["identity_lastname"] ?? "",
          email: row["identity_email"] ?? "",
          phone: row["identity_phone"] ?? "",
          address: [row["identity_address1"], row["identity_address2"]].filter(Boolean).join(", "),
          city: row["identity_city"] ?? "",
          state: row["identity_state"] ?? "",
          country: row["identity_country"] ?? "",
          postalCode: row["identity_postalcode"] ?? "",
          ssn: row["identity_ssn"] ?? "",
          passportNumber: row["identity_passportnumber"] ?? "",
          licenseNumber: row["identity_licensenumber"] ?? "",
          notes: row["notes"] ?? "",
          customFields: [],
        },
      });
    } else {
      // Default to secure note for unknown types
      items.push({
        name,
        type: "secure_note",
        data: {
          content: row["notes"] ?? "",
          notes: "",
          customFields: [],
        },
      });
    }
  }

  return items;
}

/** Simple CSV row parser handling quoted fields. */
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function ImportDialog() {
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const items = parseBitwardenCSV(reader.result as string);
        if (items.length === 0) {
          setError("No items found in CSV");
          return;
        }
        setParsedItems(items);
      } catch {
        setError("Failed to parse CSV file");
      }
    };
    reader.readAsText(file);
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
    onSuccess: (res) => {
      setResult(res);
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
        Import items from a Bitwarden CSV export. All data is encrypted client-side
        before being sent to the server.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleFileSelect}
        className="hidden"
      />

      {!parsedItems.length && !result && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground hover:border-primary hover:text-foreground w-full justify-center"
        >
          <FileText className="h-5 w-5" />
          Select Bitwarden CSV file
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
                parsedItems.reduce<Record<string, number>>((acc, item) => {
                  acc[item.type] = (acc[item.type] ?? 0) + 1;
                  return acc;
                }, {}),
              ).map(([type, count]) => (
                <li key={type}>
                  {count} {type.replace("_", " ")}(s)
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
