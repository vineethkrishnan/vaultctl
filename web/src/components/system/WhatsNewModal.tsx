// SPDX-License-Identifier: AGPL-3.0-or-later

import { Sparkles, ExternalLink, X } from "lucide-react";

interface Props {
  version?: string;
  notes?: string;
  releaseUrl?: string;
  // Heading verb: "Update available" (pre-update) vs "What's new" (post-update).
  mode: "available" | "whatsnew";
  onClose: () => void;
  onRemindLater?: () => void;
}

// renderNotes turns release-please / GitHub markdown into safe, lightly-styled
// elements (no innerHTML, no markdown dependency). It recognises ## / ###
// headings and -/* bullet lists; everything else is a paragraph. Inline **bold**
// and [text](url) markers are stripped to plain text.
function renderNotes(notes: string): React.ReactNode {
  const clean = (s: string) =>
    s
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .trim();

  const lines = notes.split("\n");
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={`ul-${out.length}`} className="ml-4 list-disc space-y-1">
        {bullets.map((b, i) => (
          <li key={i}>{clean(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,6}\s/.test(line)) {
      flush();
      out.push(
        <h4 key={`h-${out.length}`} className="mt-3 text-sm font-semibold">
          {clean(line.replace(/^#{1,6}\s/, ""))}
        </h4>,
      );
    } else if (/^[-*]\s/.test(line.trimStart())) {
      bullets.push(line.trimStart().replace(/^[-*]\s/, ""));
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      out.push(
        <p key={`p-${out.length}`} className="text-sm">
          {clean(line)}
        </p>,
      );
    }
  }
  flush();
  return out.length ? out : <p className="text-sm text-muted-foreground">No release notes.</p>;
}

export function WhatsNewModal({
  version,
  notes,
  releaseUrl,
  mode,
  onClose,
  onRemindLater,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card shadow-lg">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Sparkles className="h-5 w-5 text-brand" />
          <h2 className="text-lg font-semibold">
            {mode === "available" ? "Update available" : "What's new"}
            {version ? ` - v${version}` : ""}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2 overflow-y-auto px-5 py-4">
          {renderNotes(notes ?? "")}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4">
          {releaseUrl && (
            <a
              href={releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mr-auto inline-flex items-center gap-1.5 text-sm text-muted-foreground underline hover:text-foreground"
            >
              View full release <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {mode === "available" && onRemindLater && (
            <button
              onClick={onRemindLater}
              className="rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Remind me later
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {mode === "available" ? "Got it" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
