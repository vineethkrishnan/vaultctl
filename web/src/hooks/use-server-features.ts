// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from "@tanstack/react-query";
import {
  ALL_FEATURES_ON,
  getServerConfig,
  serverConfigQueryKey,
  type ServerFeatures,
} from "@/lib/server-config";

// useServerFeatures fetches /config once and exposes the deployment's feature
// flags. While the request is in flight, and on any server that predates the
// `features` object, it falls back to all-on so nothing is hidden prematurely.
export function useServerFeatures(): ServerFeatures {
  const { data } = useQuery({
    queryKey: serverConfigQueryKey,
    queryFn: getServerConfig,
    staleTime: Infinity,
  });
  return data?.features ?? ALL_FEATURES_ON;
}
