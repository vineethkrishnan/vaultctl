// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { ShieldAlert, Building2, UserPlus, Mail, Trash2, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  postOrgs,
  getOrgsIdMembers,
  getGetOrgsIdMembersQueryKey,
  deleteOrgsIdMembersUserId,
  putOrgsIdMembersUserId,
} from "@/api/organizations/organizations";
import {
  postOrgsIdInvites,
  getOrgsIdInvites,
  getGetOrgsIdInvitesQueryKey,
  deleteOrgsIdInvitesInviteId,
} from "@/api/invites/invites";
import {
  getAdminBackups,
  getGetAdminBackupsQueryKey,
} from "@/api/admin/admin";
import type { OrgMemberResponse, InviteResponse, BackupInfoDTO } from "@/api/model";

/**
 * Admin panel — org management, invite management, backup listing.
 * Only accessible to admin-role users.
 */
export function AdminPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-bold">Admin</h1>
      </div>

      <OrgSection />
      <BackupsSection />
    </div>
  );
}

// ============================================================================
// Organization management
// ============================================================================

function OrgSection() {
  const [orgName, setOrgName] = useState("");
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);

  const createOrg = useMutation({
    mutationFn: () => postOrgs({ name: orgName } as any),
    onSuccess: (res) => {
      if (res.status === 201) {
        setActiveOrgId((res.data as any).id);
        setOrgName("");
      }
    },
  });

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Organizations</h2>
      </div>

      {/* Create org */}
      <div className="flex gap-2">
        <input
          type="text"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="New organization name"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          onClick={() => createOrg.mutate()}
          disabled={!orgName.trim() || createOrg.isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Create
        </button>
      </div>

      {/* Org ID input for managing existing org */}
      <div className="space-y-2 border-t border-border pt-4">
        <label className="text-sm font-medium">Manage organization</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={activeOrgId ?? ""}
            onChange={(e) => setActiveOrgId(e.target.value || null)}
            placeholder="Organization ID"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>

      {activeOrgId && <MembersSubSection orgId={activeOrgId} />}
      {activeOrgId && <InvitesSubSection orgId={activeOrgId} />}
    </section>
  );
}

function MembersSubSection({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();

  const { data: res, isLoading } = useQuery({
    queryKey: getGetOrgsIdMembersQueryKey(orgId),
    queryFn: () => getOrgsIdMembers(orgId),
  });

  const members = (res?.status === 200 ? res.data : []) as OrgMemberResponse[];

  const removeMember = useMutation({
    mutationFn: (userId: string) => deleteOrgsIdMembersUserId(orgId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrgsIdMembersQueryKey(orgId) });
    },
  });

  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [newRole, setNewRole] = useState("member");

  const changeRole = useMutation({
    mutationFn: (userId: string) =>
      putOrgsIdMembersUserId(orgId, userId, { role: newRole }),
    onSuccess: () => {
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: getGetOrgsIdMembersQueryKey(orgId) });
    },
  });

  if (isLoading) return <div className="h-12 animate-pulse rounded bg-muted" />;

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <h3 className="text-sm font-medium">Members ({members.length})</h3>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members.</p>
      ) : (
        <ul className="space-y-1">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between rounded-md border border-border p-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono">{m.userId}</span>
                {editingUser === m.userId ? (
                  <div className="flex items-center gap-1">
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value)}
                      className="rounded border border-input bg-background px-1 py-0.5 text-xs"
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                      <option value="owner">owner</option>
                    </select>
                    <button
                      onClick={() => changeRole.mutate(m.userId!)}
                      className="text-primary hover:underline"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingUser(null)}
                      className="text-muted-foreground hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingUser(m.userId!);
                      setNewRole(m.role ?? "member");
                    }}
                    className="rounded-full bg-muted px-2 py-0.5 hover:bg-muted/80"
                  >
                    {m.role}
                  </button>
                )}
              </div>
              <button
                onClick={() => removeMember.mutate(m.userId!)}
                disabled={removeMember.isPending}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                title="Remove member"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InvitesSubSection({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  const { data: res } = useQuery({
    queryKey: getGetOrgsIdInvitesQueryKey(orgId),
    queryFn: () => getOrgsIdInvites(orgId),
  });

  const invites = (res?.status === 200 ? res.data : []) as InviteResponse[];

  const createInvite = useMutation({
    mutationFn: () =>
      postOrgsIdInvites(orgId, { email, role: inviteRole, expiresIn: "72h" }),
    onSuccess: () => {
      setEmail("");
      queryClient.invalidateQueries({ queryKey: getGetOrgsIdInvitesQueryKey(orgId) });
    },
  });

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) => deleteOrgsIdInvitesInviteId(orgId, inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrgsIdInvitesQueryKey(orgId) });
    },
  });

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center gap-2">
        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-sm font-medium">Invites</h3>
      </div>

      {invites.length > 0 && (
        <ul className="space-y-1">
          {invites.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center justify-between rounded-md border border-border p-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <span>{inv.email}</span>
                <span className="rounded-full bg-muted px-2 py-0.5">{inv.role}</span>
                <span className="text-muted-foreground">
                  expires {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : "—"}
                </span>
              </div>
              <button
                onClick={() => revokeInvite.mutate(inv.id!)}
                disabled={revokeInvite.isPending}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                title="Revoke invite"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-2 text-sm"
        >
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button
          onClick={() => createInvite.mutate()}
          disabled={!email.trim() || createInvite.isPending}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Invite
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Backups
// ============================================================================

function BackupsSection() {
  const { data: res, isLoading, refetch } = useQuery({
    queryKey: getGetAdminBackupsQueryKey(),
    queryFn: () => getAdminBackups(),
  });

  const backups = (res?.status === 200 ? res.data : []) as BackupInfoDTO[];

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Backups</h2>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="rounded-md border border-input p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {isLoading ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : backups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No backups found.</p>
      ) : (
        <ul className="space-y-1">
          {backups.map((b, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-md border border-border p-2 text-xs"
            >
              <span className="font-mono">{b.filename}</span>
              <div className="flex items-center gap-3 text-muted-foreground">
                <span>{formatBytes(b.size ?? 0)}</span>
                <span>{b.createdAt ? new Date(b.createdAt).toLocaleString() : "—"}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
