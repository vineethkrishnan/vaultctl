// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { apiGet, apiPut, ApiRequestError } from "@/lib/api-client";

interface Profile {
  name?: string;
  email?: string;
}

const PROFILE_QUERY_KEY = ["users", "me"] as const;

export function DisplayNameSetting() {
  const { t } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => apiGet<Profile>("/api/v1/users/me"),
    staleTime: 10 * 60 * 1000,
  });

  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const loadedName = data?.name ?? "";
  useEffect(() => {
    setName(loadedName);
  }, [loadedName]);

  const trimmed = name.trim();
  const dirty = trimmed !== loadedName && trimmed.length > 0;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setStatus("saving");
    setError(null);
    try {
      await apiPut("/api/v1/users/me", { name: trimmed });
      await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiRequestError) {
        setError(err.error.message);
      } else {
        setError(t("displayName.saveFailed"));
      }
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <UserRound className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">{t("displayName.heading")}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t("displayName.description")}</p>

      {error && (
        <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <label htmlFor="display-name" className="text-sm font-medium">
            {t("displayName.label")}
          </label>
          <input
            id="display-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (status !== "idle") setStatus("idle");
            }}
            maxLength={120}
            autoComplete="name"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>
        <button
          type="submit"
          disabled={!dirty || status === "saving"}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {status === "saving" ? t("common:actions.working") : t("common:actions.save")}
        </button>
      </form>

      {status === "saved" && (
        <span className="text-sm text-success">{t("displayName.saved")}</span>
      )}
    </section>
  );
}
