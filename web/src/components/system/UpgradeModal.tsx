// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, RotateCcw, Terminal, XCircle } from "lucide-react";
import { applyUpgrade, type UpgradeEvent } from "@/lib/system-api";

type Phase =
  | "applying"
  | "restarting"
  | "reconnecting"
  | "success"
  | "error";

const RECONNECT_POLL_MS = 2_000;
const RECONNECT_TIMEOUT_MS = 120_000;

interface Props {
  /** Step-up access token obtained from StepUpModal.onSuccess. */
  stepUpToken: string;
  targetVersion?: string;
  onClose: () => void;
}

export function UpgradeModal({ stepUpToken, targetVersion, onClose }: Props) {
  const { t } = useTranslation("system");
  const [phase, setPhase] = useState<Phase>("applying");
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>();
  const logEndRef = useRef<HTMLDivElement>(null);
  function addLog(msg: string) {
    setLogs((prev) => [...prev, msg]);
  }

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        for await (const ev of applyUpgrade(stepUpToken)) {
          if (cancelled) return;
          handleEvent(ev);
        }
      } catch (err) {
        if (!cancelled) {
          setPhase("error");
          setErrorMsg(err instanceof Error ? err.message : "Unknown error");
        }
      }
    }

    function handleEvent(ev: UpgradeEvent) {
      if (ev.type === "log" && ev.msg) {
        addLog(ev.msg);
      } else if (ev.type === "restarting") {
        addLog(ev.msg ?? t("upgrade.restarting"));
        setPhase("restarting");
        setTimeout(() => {
          if (!cancelled) pollUntilBack();
        }, 1_500);
      } else if (ev.type === "error") {
        setPhase("error");
        setErrorMsg(ev.msg);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  function pollUntilBack() {
    setPhase("reconnecting");
    const started = Date.now();

    async function poll() {
      if (Date.now() - started > RECONNECT_TIMEOUT_MS) {
        setPhase("error");
        setErrorMsg("Timed out waiting for server to come back.");
        return;
      }
      try {
        const res = await fetch("/api/v1/health", { cache: "no-store" });
        if (res.ok) {
          setPhase("success");
          return;
        }
      } catch {
        // server still down; keep polling
      }
      setTimeout(poll, RECONNECT_POLL_MS);
    }

    void poll();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            {t("upgrade.title")}
            {targetVersion && (
              <span className="text-muted-foreground"> - v{targetVersion}</span>
            )}
          </h2>
          {(phase === "success" || phase === "error") && (
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <span className="sr-only">Close</span>
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Log output */}
        <div className="h-52 overflow-y-auto bg-zinc-950 px-4 py-3 font-mono text-xs text-zinc-300">
          {logs.map((line, i) => (
            <div key={i} className="leading-5">
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        {/* Status footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          {phase === "applying" && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("upgrade.applying")}
            </span>
          )}
          {phase === "restarting" && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("upgrade.restarting")}
            </span>
          )}
          {phase === "reconnecting" && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <RotateCcw className="h-4 w-4 animate-spin" />
              {t("upgrade.reconnecting")}...
            </span>
          )}
          {phase === "success" && (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                {t("upgrade.success")}
              </span>
              <div className="flex items-center gap-3">
                <p className="text-xs text-muted-foreground">
                  {t("upgrade.extensionNote")}
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="shrink-0 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {t("upgrade.reload")}
                </button>
              </div>
            </div>
          )}
          {phase === "error" && (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4" />
                {t("upgrade.error")}{errorMsg ? `: ${errorMsg}` : ""}
              </span>
              <button
                onClick={onClose}
                className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted"
              >
                {t("common:actions.close", { defaultValue: "Close" })}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
