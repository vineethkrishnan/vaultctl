// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";
import {
  getEmailPreferences,
  setDigestFrequency,
  emailPrefsQueryKey,
  type DigestFrequency,
} from "@/lib/account-api";

const FREQUENCIES: DigestFrequency[] = [
  "off",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

export function EmailDigestSetting() {
  const { t } = useTranslation("account");
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: emailPrefsQueryKey,
    queryFn: getEmailPreferences,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: setDigestFrequency,
    onSuccess: (result) => queryClient.setQueryData(emailPrefsQueryKey, result),
  });

  // Endpoint is absent when the server has no mailer configured; hide quietly.
  if (isError) return null;

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">{t("digest.title")}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t("digest.description")}</p>
      <div className="flex items-center gap-2">
        <label htmlFor="digest-frequency" className="text-sm font-medium">
          {t("digest.frequency")}
        </label>
        <select
          id="digest-frequency"
          value={data?.digestFrequency ?? "off"}
          disabled={!data || mutation.isPending}
          onChange={(e) => mutation.mutate(e.target.value as DigestFrequency)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
        >
          {FREQUENCIES.map((value) => (
            <option key={value} value={value}>
              {t(`digest.options.${value}`)}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
