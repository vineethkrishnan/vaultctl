// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { BrandMark } from "@/components/BrandMark";
import { BookOpen, Github, Scale, Mail } from "lucide-react";

interface ServerConfig {
  version: string;
  registrationMode: string;
  appVersion?: string;
  commit?: string;
  goVersion?: string;
}

const REPO_URL = "https://github.com/vineethkrishnan/vaultctl";
const DOCS_URL = "https://vaultctl.vinelabs.de";
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
const SUPPORT_EMAIL = "support@vinelabs.de";

function shortCommit(commit: string | undefined): string {
  if (!commit || commit === "dev") return commit ?? "unknown";
  return commit.length > 10 ? commit.slice(0, 10) : commit;
}

export function AboutPanel() {
  const { data: config } = useQuery({
    queryKey: ["server-config"],
    queryFn: () => apiGet<ServerConfig>("/api/v1/config"),
    staleTime: Infinity,
  });

  const rows: { label: string; value: string }[] = [
    { label: "Version", value: config?.appVersion || "unknown" },
    { label: "Commit", value: shortCommit(config?.commit) },
    { label: "Runtime", value: config?.goVersion || "unknown" },
    { label: "Build", value: "Single Go binary with embedded web UI" },
    { label: "License", value: "AGPL-3.0-or-later" },
    { label: "Maintained by", value: "Vineeth N K" },
  ];

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-col items-center gap-3 py-3 text-center">
        <BrandMark className="text-[56px] text-brand" />
        <div className="space-y-2">
          <BrandMark variant="wordmark" className="block text-3xl" />
          <p className="text-xs text-muted-foreground">
            A zero-knowledge, self-hosted password vault.
          </p>
          <p className="mx-auto max-w-xs text-[11px] leading-relaxed text-muted-foreground">
            All cryptography runs in your browser. The server only ever stores
            encrypted data.
          </p>
        </div>
      </div>

      <dl className="divide-y divide-border rounded-md border border-border text-sm">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 px-3 py-2"
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="truncate text-right font-mono text-xs">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-brand"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Documentation
        </a>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-brand"
        >
          <Github className="h-3.5 w-3.5" />
          Source
        </a>
        <a
          href={LICENSE_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-brand"
        >
          <Scale className="h-3.5 w-3.5" />
          License
        </a>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-brand"
        >
          <Mail className="h-3.5 w-3.5" />
          {SUPPORT_EMAIL}
        </a>
      </div>
    </section>
  );
}
