// SPDX-License-Identifier: AGPL-3.0-or-later

export function canAdminister(role: string | null): boolean {
  return role === "admin" || role === "owner";
}
