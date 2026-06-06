// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from "@tanstack/react-query";
import {
  getUpdateStatus,
  getNotifyLevel,
  severityPassesLevel,
  isUpdateSnoozed,
  type UpdateStatus,
} from "@/lib/system-api";

// Single source of truth for whether an available update should be surfaced to
// the user, applied identically by the top banner, the sidebar bell count, and
// the notifications page. With no saved preference getNotifyLevel() is "all",
// so an available update shows by default. Pass enabled=false on deployments
// where the updates feature is off so the /updates endpoint is never polled.
export function useUpdateNotification(enabled = true): {
  status: UpdateStatus | undefined;
  show: boolean;
} {
  const { data } = useQuery({
    queryKey: ["system", "updates"],
    queryFn: getUpdateStatus,
    // The server detects a release within ~15m; poll on a matching cadence (and
    // on tab focus) so a long-lived session reflects it without a reload.
    staleTime: 10 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    enabled,
  });

  const show =
    !!data &&
    data.updateAvailable &&
    !isUpdateSnoozed() &&
    severityPassesLevel(data.severity, getNotifyLevel());

  return { status: data, show };
}
