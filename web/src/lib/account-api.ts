// SPDX-License-Identifier: AGPL-3.0-or-later

// Hand-written wrappers for account/email-verification endpoints. The generated
// Orval client's UserProfileResponse does not yet carry emailVerified, so these
// flows use the raw fetch helpers (like system-api.ts) until the client is
// regenerated against the updated swagger.

import { apiGet, apiPost, apiPut } from "@/lib/api-client";

export interface AccountStatus {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
  emailVerified: boolean;
  emailVerifiedAt?: string;
}

export const accountStatusQueryKey = ["account", "status"] as const;

export const getAccountStatus = () => apiGet<AccountStatus>("/api/v1/users/me");

export const verifyEmail = (code: string) =>
  apiPost<void>("/api/v1/auth/email/verify", { code });

export const resendEmailVerification = () =>
  apiPost<void>("/api/v1/auth/email/resend");

// VerificationGraceDays mirrors the server's unverified grace window. After it
// elapses an unverified account becomes read-only (see grace enforcement).
export const VerificationGraceDays = 7;

export function graceDaysLeft(createdAt: string, now: Date = new Date()): number {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return VerificationGraceDays;
  const elapsedDays = (now.getTime() - created) / 86_400_000;
  return Math.max(0, Math.ceil(VerificationGraceDays - elapsedDays));
}

export type DigestFrequency =
  | "off"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

// EmailPreferences mirrors the backend EmailPreferencesResponse. Schedule fields
// are null for components not relevant to the chosen frequency.
export interface EmailPreferences {
  digestFrequency: DigestFrequency;
  loginAlerts: boolean;
  locale: string;
  timezone: string;
  schedHour: number | null;
  schedMinute: number | null;
  schedWeekday: number | null;
  schedDay: number | null;
  schedMonth: number | null;
}

// UpdateEmailPreferences carries only the fields the caller wants to change;
// omitted fields leave that preference untouched (pointer semantics server-side).
export interface UpdateEmailPreferences {
  digestFrequency?: DigestFrequency;
  loginAlerts?: boolean;
  locale?: string;
  timezone?: string;
  schedHour?: number | null;
  schedMinute?: number | null;
  schedWeekday?: number | null;
  schedDay?: number | null;
  schedMonth?: number | null;
}

export const emailPrefsQueryKey = ["account", "email-preferences"] as const;

export const getEmailPreferences = () =>
  apiGet<EmailPreferences>("/api/v1/users/me/email-preferences");

export const updateEmailPreferences = (update: UpdateEmailPreferences) =>
  apiPut<EmailPreferences>("/api/v1/users/me/email-preferences", update);
