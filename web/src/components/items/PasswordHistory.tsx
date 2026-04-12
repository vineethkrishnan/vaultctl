import { useState } from "react";
import { History, Eye, EyeOff, Copy, Check } from "lucide-react";
import type { PasswordHistoryEntry } from "@/shared/types/item-data";

interface PasswordHistoryProps {
  entries: PasswordHistoryEntry[];
}

export function PasswordHistory({ entries }: PasswordHistoryProps) {
  if (!entries || entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">Password history</span>
        <span className="text-xs text-muted-foreground">
          ({entries.length})
        </span>
      </div>
      <ul className="space-y-1">
        {entries.map((entry, i) => (
          <PasswordHistoryRow key={i} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

function PasswordHistoryRow({ entry }: { entry: PasswordHistoryEntry }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(entry.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied — fail silently (no sensitive data to leak)
    }
  }

  return (
    <li className="flex items-center justify-between rounded-md border border-border p-2 text-xs">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="font-mono truncate">
          {visible ? entry.password : "\u2022".repeat(Math.min(entry.password.length, 20))}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-muted-foreground">
          {formatDate(entry.changedAt)}
        </span>
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          title={visible ? "Hide" : "Show"}
        >
          {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          title="Copy"
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
    </li>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
