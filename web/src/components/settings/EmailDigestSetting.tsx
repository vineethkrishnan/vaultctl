// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import {
  getEmailPreferences,
  setDigestFrequency,
  emailPrefsQueryKey,
  type DigestFrequency,
} from "@/lib/account-api";

const OPTIONS: { value: DigestFrequency; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export function EmailDigestSetting() {
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
        <h2 className="font-semibold">Email digest</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Get a periodic summary of account activity: sign-ins, items added,
        new-device alerts, and reminders to rotate stale logins.
      </p>
      <div className="flex items-center gap-2">
        <label htmlFor="digest-frequency" className="text-sm font-medium">
          Frequency
        </label>
        <select
          id="digest-frequency"
          value={data?.digestFrequency ?? "off"}
          disabled={!data || mutation.isPending}
          onChange={(e) => mutation.mutate(e.target.value as DigestFrequency)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
