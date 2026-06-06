// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";
import {
  getEmailPreferences,
  updateEmailPreferences,
  emailPrefsQueryKey,
  type DigestFrequency,
  type UpdateEmailPreferences,
} from "@/lib/account-api";

const FREQUENCIES: DigestFrequency[] = [
  "off",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

const DEFAULT_HOUR = 8;
const DEFAULT_MINUTE = 0;
const DEFAULT_WEEKDAY = 1; // Monday
const DEFAULT_DAY = 1;
const DEFAULT_MONTH = 1;

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]; // Sunday=0, matches Go time.Weekday
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// Common fallback when Intl.supportedValuesOf is unavailable (older browsers).
const FALLBACK_TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function timezoneOptions(selected: string): string[] {
  let list: string[] = FALLBACK_TIMEZONES;
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported === "function") {
    try {
      list = supported("timeZone");
    } catch {
      list = FALLBACK_TIMEZONES;
    }
  }
  return list.includes(selected) ? list : [selected, ...list];
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

const selectClass =
  "rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20 disabled:opacity-50";

export function EmailDigestSetting() {
  const { t, i18n } = useTranslation("account");
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: emailPrefsQueryKey,
    queryFn: getEmailPreferences,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: updateEmailPreferences,
    onSuccess: (result) => queryClient.setQueryData(emailPrefsQueryKey, result),
  });

  const frequency = data?.digestFrequency ?? "off";
  const timezone = data?.timezone || browserTimezone();
  const hour = data?.schedHour ?? DEFAULT_HOUR;
  const minute = data?.schedMinute ?? DEFAULT_MINUTE;
  const weekday = data?.schedWeekday ?? DEFAULT_WEEKDAY;
  const day = data?.schedDay ?? DEFAULT_DAY;
  const month = data?.schedMonth ?? DEFAULT_MONTH;

  const summary = useMemo(
    () =>
      buildSummary(t, i18n.language, frequency, timezone, hour, minute, weekday, day, month),
    [t, i18n.language, frequency, timezone, hour, minute, weekday, day, month],
  );

  // Endpoint is absent when the server has no mailer configured; hide quietly.
  if (isError) return null;

  const disabled = !data || mutation.isPending;
  const showTime = frequency !== "off";
  const showWeekday = frequency === "weekly";
  const showDay = frequency === "monthly" || frequency === "quarterly";
  const showMonth = frequency === "yearly";

  // Builds the schedule fields relevant to a frequency, sending null for the
  // rest so the server clears stale components.
  function scheduleFor(
    freq: DigestFrequency,
    overrides: Partial<UpdateEmailPreferences> = {},
  ): UpdateEmailPreferences {
    if (freq === "off") return { digestFrequency: freq };
    const base: UpdateEmailPreferences = {
      digestFrequency: freq,
      timezone,
      schedHour: hour,
      schedMinute: minute,
      schedWeekday: freq === "weekly" ? weekday : null,
      schedDay: freq === "monthly" || freq === "quarterly" || freq === "yearly" ? day : null,
      schedMonth: freq === "yearly" ? month : null,
    };
    return { ...base, ...overrides };
  }

  function save(update: UpdateEmailPreferences) {
    mutation.mutate(update);
  }

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">{t("digest.title")}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t("digest.description")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="digest-frequency" className="text-sm font-medium">
          {t("digest.frequency")}
        </label>
        <select
          id="digest-frequency"
          value={frequency}
          disabled={disabled}
          onChange={(e) => save(scheduleFor(e.target.value as DigestFrequency))}
          className={selectClass}
        >
          {FREQUENCIES.map((value) => (
            <option key={value} value={value}>
              {t(`digest.options.${value}`)}
            </option>
          ))}
        </select>
      </div>

      {frequency !== "off" && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            {showMonth && (
              <div className="flex flex-col gap-1">
                <label htmlFor="digest-month" className="text-sm font-medium">
                  {t("digest.month")}
                </label>
                <select
                  id="digest-month"
                  value={month}
                  disabled={disabled}
                  onChange={(e) =>
                    save(scheduleFor(frequency, { schedMonth: Number(e.target.value) }))
                  }
                  className={selectClass}
                >
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {monthName(i18n.language, m)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showDay && (
              <div className="flex flex-col gap-1">
                <label htmlFor="digest-day" className="text-sm font-medium">
                  {t("digest.dayOfMonth")}
                </label>
                <select
                  id="digest-day"
                  value={day}
                  disabled={disabled}
                  onChange={(e) =>
                    save(scheduleFor(frequency, { schedDay: Number(e.target.value) }))
                  }
                  className={selectClass}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showWeekday && (
              <div className="flex flex-col gap-1">
                <label htmlFor="digest-weekday" className="text-sm font-medium">
                  {t("digest.weekday")}
                </label>
                <select
                  id="digest-weekday"
                  value={weekday}
                  disabled={disabled}
                  onChange={(e) =>
                    save(scheduleFor(frequency, { schedWeekday: Number(e.target.value) }))
                  }
                  className={selectClass}
                >
                  {WEEKDAYS.map((wd) => (
                    <option key={wd} value={wd}>
                      {weekdayName(i18n.language, wd)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showTime && (
              <div className="flex flex-col gap-1">
                <label htmlFor="digest-time" className="text-sm font-medium">
                  {t("digest.time")}
                </label>
                <input
                  id="digest-time"
                  type="time"
                  value={`${pad2(hour)}:${pad2(minute)}`}
                  disabled={disabled}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    if (Number.isNaN(h) || Number.isNaN(m)) return;
                    save(scheduleFor(frequency, { schedHour: h, schedMinute: m }));
                  }}
                  className={selectClass}
                />
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor="digest-timezone" className="text-sm font-medium">
                {t("digest.timezone")}
              </label>
              <select
                id="digest-timezone"
                value={timezone}
                disabled={disabled}
                onChange={(e) =>
                  save({ ...scheduleFor(frequency), timezone: e.target.value })
                }
                className={selectClass}
              >
                {timezoneOptions(timezone).map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{summary}</p>
          <p className="text-xs text-muted-foreground">{t("digest.defaultHint")}</p>
        </>
      )}
    </section>
  );
}

function weekdayName(locale: string, weekday: number): string {
  // 2024-01-07 is a Sunday; add weekday days to get the right name.
  const base = new Date(Date.UTC(2024, 0, 7 + weekday));
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(base);
}

function monthName(locale: string, month: number): string {
  const base = new Date(Date.UTC(2024, month - 1, 1));
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(base);
}

function buildSummary(
  t: (key: string, opts?: Record<string, unknown>) => string,
  locale: string,
  frequency: DigestFrequency,
  timezone: string,
  hour: number,
  minute: number,
  weekday: number,
  day: number,
  month: number,
): string {
  const time = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  switch (frequency) {
    case "daily":
      return t("digest.summary.daily", { time, timezone });
    case "weekly":
      return t("digest.summary.weekly", {
        weekday: weekdayName(locale, weekday),
        time,
        timezone,
      });
    case "monthly":
      return t("digest.summary.monthly", { day, time, timezone });
    case "quarterly":
      return t("digest.summary.quarterly", { day, time, timezone });
    case "yearly":
      return t("digest.summary.yearly", {
        month: monthName(locale, month),
        day,
        time,
        timezone,
      });
    default:
      return "";
  }
}
