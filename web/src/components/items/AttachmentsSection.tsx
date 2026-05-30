// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Download, Trash2, Loader2, Upload } from "lucide-react";
import { queryKeys } from "@/lib/query-keys";
import {
  type AttachmentMeta,
  listAttachments,
  uploadAttachment,
  downloadAttachment,
  deleteAttachment,
  decryptFilename,
} from "@/lib/attachments";

interface Props {
  vaultId: string;
  itemId: string;
}

export function AttachmentsSection({ vaultId, itemId }: Props) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: attachments, isLoading } = useQuery({
    queryKey: queryKeys.attachments.list(vaultId, itemId),
    queryFn: () => listAttachments(vaultId, itemId),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.attachments.list(vaultId, itemId),
    });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadAttachment(vaultId, itemId, file),
    onSuccess: invalidate,
    onError: (e) =>
      setError(e instanceof Error ? e.message : "Upload failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAttachment(vaultId, itemId, id),
    onSuccess: invalidate,
  });

  async function handleFiles(files: FileList | null) {
    setError(null);
    if (!files) return;
    for (const file of Array.from(files)) {
      await uploadMutation.mutateAsync(file).catch(() => {});
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          Attachments
        </div>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploadMutation.isPending}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {uploadMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {uploadMutation.isPending ? "Encrypting..." : "Add file"}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {isLoading ? (
        <div className="h-10 animate-pulse rounded bg-muted" />
      ) : !attachments || attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No attachments. Files are encrypted in your browser before upload.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              vaultId={vaultId}
              itemId={itemId}
              attachment={attachment}
              onDelete={() => deleteMutation.mutate(attachment.id)}
              deleting={
                deleteMutation.isPending &&
                deleteMutation.variables === attachment.id
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AttachmentRow({
  vaultId,
  itemId,
  attachment,
  onDelete,
  deleting,
}: {
  vaultId: string;
  itemId: string;
  attachment: AttachmentMeta;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [filename, setFilename] = useState("Decrypting...");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    decryptFilename(vaultId, attachment)
      .then((name) => {
        if (!cancelled) setFilename(name);
      })
      .catch(() => {
        if (!cancelled) setFilename("[name unavailable]");
      });
    return () => {
      cancelled = true;
    };
  }, [vaultId, attachment]);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadAttachment(vaultId, itemId, attachment);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <li className="group flex items-center gap-2 rounded-md border border-border px-2.5 py-2">
      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{filename}</div>
        <div className="text-xs text-muted-foreground">
          {formatBytes(attachment.size)}
        </div>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        title="Download and decrypt"
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        className="rounded-md p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
        title="Delete attachment"
      >
        {deleting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </button>
    </li>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || size % 1 === 0 ? 0 : 1)} ${units[unit]!}`;
}
