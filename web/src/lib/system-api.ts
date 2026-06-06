// SPDX-License-Identifier: AGPL-3.0-or-later

// Client wrappers for the server's update-check and notification endpoints
// (see internal/presenters/api/update_handlers.go + notification_handlers.go).
// These use the raw fetch helpers, like the other hand-written flows.

import { apiGet, apiPost } from "@/lib/api-client";

export type UpdateSeverity = "major" | "minor" | "patch" | "none" | "";

export interface UpdateStatus {
  enabled: boolean;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  severity?: UpdateSeverity;
  releaseNotes?: string;
  releaseUrl?: string;
  publishedAt?: string;
}

export type NotificationCategory = "security" | "vault" | "account" | "backup";

export interface NotificationItem {
  id: string;
  action: string;
  title: string;
  category: NotificationCategory;
  createdAt: string;
  read: boolean;
}

export interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
}

export const getUpdateStatus = () => apiGet<UpdateStatus>("/api/v1/updates");

// ── Audit trail (FEAT-2) ───────────────────────────────────────────────────

export interface AuditEntry {
  action: string;
  resourceType?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface AuditPage {
  entries: AuditEntry[];
  nextBefore?: string;
}

export function getOwnAudit(
  params: { limit?: number; before?: string } = {},
): Promise<AuditPage> {
  const search = new URLSearchParams();
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.before) search.set("before", params.before);
  const query = search.toString();
  return apiGet<AuditPage>(`/api/v1/users/me/audit${query ? `?${query}` : ""}`);
}

export const getNotifications = () =>
  apiGet<NotificationsResponse>("/api/v1/notifications");

export const markNotificationsRead = () =>
  apiPost<{ ok: boolean }>("/api/v1/notifications/read");

export const clearNotifications = () =>
  apiPost<{ ok: boolean }>("/api/v1/notifications/clear");

// ── Local preferences (this device) ───────────────────────────────────────

// How aggressively to surface the "update available" banner. "auto-update" is
// not literally possible for the self-hosted server, so this controls which
// severities raise the banner. The extension PR uses the same preference name.
export type NotifyLevel = "all" | "minor" | "major" | "off";

const NOTIFY_LEVEL_KEY = "vaultctl_update_notify_level";
const SNOOZE_KEY = "vaultctl_update_snooze_until";
const LAST_SEEN_VERSION_KEY = "vaultctl_last_seen_version";

export function getNotifyLevel(): NotifyLevel {
  const v = localStorage.getItem(NOTIFY_LEVEL_KEY);
  return v === "all" || v === "minor" || v === "major" || v === "off" ? v : "all";
}

export function setNotifyLevel(level: NotifyLevel): void {
  localStorage.setItem(NOTIFY_LEVEL_KEY, level);
}

// severityPassesLevel decides whether a given update severity should raise the
// banner under the chosen preference. "minor" means minor + major; "major"
// means major only.
export function severityPassesLevel(
  severity: UpdateSeverity | undefined,
  level: NotifyLevel,
): boolean {
  if (level === "off") return false;
  if (level === "all") return true;
  if (level === "major") return severity === "major";
  // "minor"
  return severity === "minor" || severity === "major";
}

export function snoozeUpdate(hours = 24): void {
  localStorage.setItem(SNOOZE_KEY, String(Date.now() + hours * 3_600_000));
}

export function isUpdateSnoozed(): boolean {
  const until = Number(localStorage.getItem(SNOOZE_KEY) ?? "0");
  return until > Date.now();
}

export function clearSnooze(): void {
  localStorage.removeItem(SNOOZE_KEY);
}

// last-seen version drives the post-update "what's new" surface.
export function getLastSeenVersion(): string | null {
  return localStorage.getItem(LAST_SEEN_VERSION_KEY);
}

export function setLastSeenVersion(version: string): void {
  localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
}
