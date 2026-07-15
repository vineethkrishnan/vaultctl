// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bold, Italic, Heading, List, Link as LinkIcon, Code } from "lucide-react";
import { useAutoResize } from "@/hooks/use-auto-resize";

interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

type Wrap = { before: string; after: string };
type LinePrefix = { prefix: string };
type Action = Wrap | LinePrefix;

const isWrap = (action: Action): action is Wrap => "before" in action;

const ACTIONS: { key: string; icon: typeof Bold; action: Action }[] = [
  { key: "bold", icon: Bold, action: { before: "**", after: "**" } },
  { key: "italic", icon: Italic, action: { before: "_", after: "_" } },
  { key: "code", icon: Code, action: { before: "`", after: "`" } },
  { key: "link", icon: LinkIcon, action: { before: "[", after: "](https://)" } },
  { key: "heading", icon: Heading, action: { prefix: "## " } },
  { key: "bulletList", icon: List, action: { prefix: "- " } },
];

export function MarkdownEditor({ id, value, onChange, placeholder, readOnly }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const [previewing, setPreviewing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(textareaRef, previewing ? "" : value);

  function apply(action: Action) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const { selectionStart, selectionEnd } = textarea;
    const selected = value.slice(selectionStart, selectionEnd);

    if (isWrap(action)) {
      const next =
        value.slice(0, selectionStart) +
        action.before +
        selected +
        action.after +
        value.slice(selectionEnd);
      onChange(next);
      queueMicrotask(() => {
        textarea.focus();
        textarea.setSelectionRange(
          selectionStart + action.before.length,
          selectionEnd + action.before.length,
        );
      });
      return;
    }

    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const next =
      value.slice(0, lineStart) + action.prefix + value.slice(lineStart);
    onChange(next);
    queueMicrotask(() => {
      textarea.focus();
      const offset = action.prefix.length;
      textarea.setSelectionRange(selectionStart + offset, selectionEnd + offset);
    });
  }

  return (
    <div className="w-full rounded-md border border-input bg-background">
      <div className="flex items-center gap-0.5 border-b border-input px-1.5 py-1">
        {ACTIONS.map(({ key, icon: Icon, action }) => (
          <button
            key={key}
            type="button"
            disabled={readOnly || previewing}
            onClick={() => apply(action)}
            aria-label={t(`vault:markdown.${key}`)}
            title={t(`vault:markdown.${key}`)}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPreviewing(!previewing)}
          aria-pressed={previewing}
          className="ml-auto rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {previewing ? t("vault:markdown.edit") : t("vault:markdown.preview")}
        </button>
      </div>

      {previewing ? (
        <div
          data-testid="markdown-preview"
          className="prose-vault max-h-80 min-h-[4rem] overflow-y-auto px-3 py-2 text-sm"
        >
          {value.trim() ? (
            <MarkdownPreview value={value} />
          ) : (
            <span className="text-muted-foreground">
              {t("vault:markdown.nothingToPreview")}
            </span>
          )}
        </div>
      ) : (
        <textarea
          id={id}
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          rows={2}
          className="max-h-80 w-full resize-y overflow-y-auto bg-transparent px-3 py-2 font-mono text-sm outline-none"
        />
      )}
    </div>
  );
}

export function MarkdownPreview({ value }: { value: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      disallowedElements={["img"]}
      unwrapDisallowed
      components={{
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        ),
      }}
    >
      {value}
    </ReactMarkdown>
  );
}
