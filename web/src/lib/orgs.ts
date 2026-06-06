// SPDX-License-Identifier: AGPL-3.0-or-later

// Hand-written wrapper for GET /orgs (FEAT-8). The endpoint returns the
// caller's own org memberships with the role they hold and when they joined -
// a different shape from the generated OrgResponse (which describes an org
// record, not a membership), so it lives here rather than in the orval client.

import { apiGet } from "@/lib/api-client";

export interface MyOrg {
  id: string;
  name: string;
  role: string;
  joinedAt?: string;
}

export const myOrgsQueryKey = ["my-orgs"] as const;

export const getMyOrgs = () => apiGet<MyOrg[]>("/api/v1/orgs");
