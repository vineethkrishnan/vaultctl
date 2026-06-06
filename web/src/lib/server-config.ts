// SPDX-License-Identifier: AGPL-3.0-or-later

// Hand-written wrapper for the public /config endpoint and the feature flags it
// advertises (FEAT-7). The server conditionally mounts whole feature sets
// (attachments, backup sync, mailer-gated email verify/digest, updates,
// notifications), so the client gates UI on the `features` object to avoid
// rendering panels that would 404 against a deployment with the feature off.

import { apiGet } from "@/lib/api-client";

export interface ServerFeatures {
  backupSync: boolean;
  attachments: boolean;
  mailer: boolean;
  emailVerification: boolean;
  updates: boolean;
  notifications: boolean;
  require2fa: boolean;
  hibp: boolean;
}

export interface ServerConfig {
  version: string;
  registrationMode: string;
  appVersion?: string;
  commit?: string;
  goVersion?: string;
  features?: ServerFeatures;
}

export const serverConfigQueryKey = ["server-config"] as const;

export const getServerConfig = () => apiGet<ServerConfig>("/api/v1/config");

// ALL_FEATURES_ON is the backward-compatible default: an older server that
// predates the `features` object is treated as having every feature wired, so
// the client never hides a panel just because the field is absent.
export const ALL_FEATURES_ON: ServerFeatures = {
  backupSync: true,
  attachments: true,
  mailer: true,
  emailVerification: true,
  updates: true,
  notifications: true,
  require2fa: false,
  hibp: true,
};
