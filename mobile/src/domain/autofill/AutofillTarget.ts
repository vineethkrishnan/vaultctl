// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the OS is asking us to fill.
 *
 * A browser gives a web origin. A native app gives only its package name
 * (Android) or bundle id (iOS), which is NOT a domain and must never be
 * string-matched against one: "com.evil.paypal" contains "paypal".
 */
export type AutofillTarget =
  | { kind: "web"; url: string }
  | { kind: "app"; platform: "android" | "ios"; identifier: string };

export function webTarget(url: string): AutofillTarget {
  return { kind: "web", url };
}

export function appTarget(
  platform: "android" | "ios",
  identifier: string,
): AutofillTarget {
  return { kind: "app", platform, identifier };
}
