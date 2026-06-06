// SPDX-License-Identifier: AGPL-3.0-or-later

// First-run checklist (FEAT-10) shown on the vault items page until the user
// finishes or dismisses it. Completion and dismissal are tracked per-user in
// localStorage so a returning user with a stocked vault never sees it again.
// It is a guide, not a gate: every step is optional and the panel can always
// be dismissed.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  KeyRound,
  ShieldCheck,
  Puzzle,
  Plus,
  Upload,
  Check,
  X,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";

const EXTENSION_URL =
  "https://github.com/vineethkrishnan/vaultctl/tree/main/extension";

type StepId = "recovery" | "twofa" | "extension" | "firstItem";

const STEP_ORDER: StepId[] = ["recovery", "twofa", "extension", "firstItem"];

const STEP_ICONS: Record<StepId, LucideIcon> = {
  recovery: KeyRound,
  twofa: ShieldCheck,
  extension: Puzzle,
  firstItem: Plus,
};

interface OnboardingState {
  dismissed: boolean;
  completed: StepId[];
}

function storageKey(userId: string | null): string {
  return `vaultctl_onboarding_${userId ?? "anon"}`;
}

function readState(userId: string | null): OnboardingState {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { dismissed: false, completed: [] };
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      dismissed: Boolean(parsed.dismissed),
      completed: Array.isArray(parsed.completed)
        ? parsed.completed.filter((step): step is StepId =>
            STEP_ORDER.includes(step as StepId),
          )
        : [],
    };
  } catch {
    return { dismissed: false, completed: [] };
  }
}

interface OnboardingChecklistProps {
  vaultId: string;
  hasItems: boolean;
}

export function OnboardingChecklist({
  vaultId,
  hasItems,
}: OnboardingChecklistProps) {
  const { t } = useTranslation("onboarding");
  const userId = useAuthStore((s) => s.userId);
  const [state, setState] = useState<OnboardingState>(() => readState(userId));

  // The "first item" step completes itself once the vault has any item, so a
  // user who jumps straight to adding a login still sees the step tick off.
  const isStepDone = (step: StepId): boolean =>
    state.completed.includes(step) || (step === "firstItem" && hasItems);

  const doneCount = STEP_ORDER.filter(isStepDone).length;
  const allDone = doneCount === STEP_ORDER.length;

  if (state.dismissed || allDone) return null;

  function persist(next: OnboardingState) {
    setState(next);
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(next));
    } catch {
      // localStorage may be unavailable (private mode); the checklist simply
      // reappears next load, which is acceptable for a non-blocking guide.
    }
  }

  function markDone(step: StepId) {
    if (state.completed.includes(step)) return;
    persist({ ...state, completed: [...state.completed, step] });
  }

  function dismiss() {
    persist({ ...state, dismissed: true });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">{t("title")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {t("progress", { done: doneCount, total: STEP_ORDER.length })}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          aria-label={t("dismiss")}
          title={t("dismiss")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ul className="space-y-2">
        {STEP_ORDER.map((step) => (
          <StepRow
            key={step}
            step={step}
            done={isStepDone(step)}
            vaultId={vaultId}
            onMarkDone={() => markDone(step)}
          />
        ))}
      </ul>
    </section>
  );
}

function StepRow({
  step,
  done,
  vaultId,
  onMarkDone,
}: {
  step: StepId;
  done: boolean;
  vaultId: string;
  onMarkDone: () => void;
}) {
  const { t } = useTranslation("onboarding");
  const Icon = STEP_ICONS[step];

  return (
    <li className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          done
            ? "bg-green-500/15 text-green-600 dark:text-green-400"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}
        >
          {t(`${step}.title`)}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{t(`${step}.description`)}</p>
        {!done && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <StepActions step={step} vaultId={vaultId} />
            {step !== "firstItem" && (
              <button
                type="button"
                onClick={onMarkDone}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {t("markDone")}
              </button>
            )}
          </div>
        )}
      </div>
      {done && (
        <span className="mt-0.5 shrink-0 text-xs font-medium text-green-600 dark:text-green-400">
          {t("done")}
        </span>
      )}
    </li>
  );
}

function StepActions({
  step,
  vaultId,
}: {
  step: StepId;
  vaultId: string;
}) {
  const { t } = useTranslation("onboarding");
  const linkClass =
    "font-medium text-primary hover:underline";

  if (step === "recovery") {
    return (
      <Link to="/settings" search={{ tab: "security" } as never} className={linkClass}>
        {t("recovery.action")}
      </Link>
    );
  }
  if (step === "twofa") {
    return (
      <Link to="/settings" search={{ tab: "security" } as never} className={linkClass}>
        {t("twofa.action")}
      </Link>
    );
  }
  if (step === "extension") {
    return (
      <a
        href={EXTENSION_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
      >
        {t("extension.action")}
      </a>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <Link
        to="/vault/$vaultId/items/new"
        params={{ vaultId }}
        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("firstItem.addAction")}
      </Link>
      <Link
        to="/settings"
        search={{ tab: "data" } as never}
        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
      >
        <Upload className="h-3.5 w-3.5" />
        {t("firstItem.importAction")}
      </Link>
    </div>
  );
}
