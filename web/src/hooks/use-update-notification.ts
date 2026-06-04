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
// so an available update shows by default.
export function useUpdateNotification(): {
  status: UpdateStatus | undefined;
  show: boolean;
} {
  const { data } = useQuery({
    queryKey: ["system", "updates"],
    queryFn: getUpdateStatus,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const show =
    !!data &&
    data.updateAvailable &&
    !isUpdateSnoozed() &&
    severityPassesLevel(data.severity, getNotifyLevel());

  return { status: data, show };
}
