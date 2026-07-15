// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Paperclip, Trash2, Upload } from "lucide-react";

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Attachment picker for the create flow. The upload endpoint needs an item id,
 * which does not exist until the item is saved, so files are held here and
 * uploaded by the caller once the item comes back.
 */
export function PendingAttachments({ files, onChange, disabled }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          {t("vault:attachments.heading")}
        </div>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {t("vault:attachments.addFile")}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) onChange([...files, ...Array.from(e.target.files)]);
            e.target.value = "";
          }}
        />
      </div>

      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("vault:attachments.pendingEmpty")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                disabled={disabled}
                aria-label={t("vault:fields.remove")}
                title={t("vault:fields.remove")}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
