// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, Building2, UserPlus, Mail, Trash2, RefreshCw, ChevronRight } from "lucide-react";
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
import { getMyOrgs, myOrgsQueryKey, type MyOrg } from "@/lib/orgs";

/**
 * Admin panel - org management, invite management, backup listing.
 * Only accessible to admin-role users.
 */
export function AdminPage() {
  const { t } = useTranslation("admin");
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-bold">{t("title")}</h1>
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
  const { t } = useTranslation("admin");
  const queryClient = useQueryClient();
  const [orgName, setOrgName] = useState("");
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);

  const { data: orgs, isLoading } = useQuery({
    queryKey: myOrgsQueryKey,
    queryFn: getMyOrgs,
  });

  const createOrg = useMutation({
    mutationFn: () => postOrgs({ name: orgName } as any),
    onSuccess: (res) => {
      if (res.status === 201) {
        setActiveOrgId((res.data as any).id);
        setOrgName("");
        queryClient.invalidateQueries({ queryKey: myOrgsQueryKey });
      }
    },
  });

  const activeOrg = orgs?.find((org) => org.id === activeOrgId) ?? null;

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">{t("orgs.heading")}</h2>
      </div>

      {/* Create org */}
      <div className="flex gap-2">
        <input
          type="text"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder={t("orgs.newNamePlaceholder")}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          onClick={() => createOrg.mutate()}
          disabled={!orgName.trim() || createOrg.isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t("orgs.create")}
        </button>
      </div>

      {/* Selectable list of the caller's organizations */}
      <div className="space-y-2 border-t border-border pt-4">
        <label className="text-sm font-medium">{t("orgs.manageLabel")}</label>
        {isLoading ? (
          <div className="h-12 animate-pulse rounded bg-muted" />
        ) : !orgs || orgs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("orgs.empty")}</p>
        ) : (
          <ul className="space-y-1">
            {orgs.map((org) => (
              <OrgRow
                key={org.id}
                org={org}
                selected={org.id === activeOrgId}
                onSelect={() =>
                  setActiveOrgId((current) => (current === org.id ? null : org.id))
                }
              />
            ))}
          </ul>
        )}
      </div>

      {activeOrg && <MembersSubSection orgId={activeOrg.id} />}
      {activeOrg && <InvitesSubSection orgId={activeOrg.id} />}
    </section>
  );
}

function OrgRow({
  org,
  selected,
  onSelect,
}: {
  org: MyOrg;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation("admin");
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex w-full items-center justify-between gap-2 rounded-md border p-2.5 text-left text-sm transition-colors ${
          selected
            ? "border-primary bg-primary/5"
            : "border-border hover:bg-accent/50"
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{org.name}</span>
          <span className="block text-xs text-muted-foreground">
            {org.role ? t(`roles.${org.role}`) : org.role}
          </span>
        </span>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            selected ? "rotate-90" : ""
          }`}
        />
      </button>
    </li>
  );
}

function MembersSubSection({ orgId }: { orgId: string }) {
  const { t } = useTranslation("admin");
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
      <h3 className="text-sm font-medium">{t("members.heading", { count: members.length })}</h3>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("members.empty")}</p>
      ) : (
        <ul className="space-y-1">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between rounded-md border border-border p-2 text-xs"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0">
                  <span className="block font-medium">{t("members.memberLabel")}</span>
                  <span
                    className="block truncate font-mono text-[0.65rem] text-muted-foreground"
                    title={m.userId}
                  >
                    {t("members.userIdLabel", { id: m.userId })}
                  </span>
                </span>
                {editingUser === m.userId ? (
                  <div className="flex items-center gap-1">
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value)}
                      className="rounded border border-input bg-background px-1 py-0.5 text-xs"
                    >
                      <option value="member">{t("roles.member")}</option>
                      <option value="admin">{t("roles.admin")}</option>
                      <option value="owner">{t("roles.owner")}</option>
                    </select>
                    <button
                      onClick={() => changeRole.mutate(m.userId!)}
                      className="text-primary hover:underline"
                    >
                      {t("members.save")}
                    </button>
                    <button
                      onClick={() => setEditingUser(null)}
                      className="text-muted-foreground hover:underline"
                    >
                      {t("members.cancel")}
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
                    {m.role ? t(`roles.${m.role}`) : m.role}
                  </button>
                )}
              </div>
              <button
                onClick={() => removeMember.mutate(m.userId!)}
                disabled={removeMember.isPending}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                title={t("members.remove")}
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
  const { t } = useTranslation("admin");
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
        <h3 className="text-sm font-medium">{t("invites.heading")}</h3>
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
                <span className="rounded-full bg-muted px-2 py-0.5">
                  {inv.role ? t(`roles.${inv.role}`) : inv.role}
                </span>
                <span className="text-muted-foreground">
                  {t("invites.expires", {
                    date: inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : "-",
                  })}
                </span>
              </div>
              <button
                onClick={() => revokeInvite.mutate(inv.id!)}
                disabled={revokeInvite.isPending}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                title={t("invites.revoke")}
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
          placeholder={t("invites.emailPlaceholder")}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-2 text-sm"
        >
          <option value="member">{t("roles.member")}</option>
          <option value="admin">{t("roles.admin")}</option>
        </select>
        <button
          onClick={() => createInvite.mutate()}
          disabled={!email.trim() || createInvite.isPending}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <UserPlus className="h-3.5 w-3.5" />
          {t("invites.invite")}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Backups
// ============================================================================

function BackupsSection() {
  const { t } = useTranslation("admin");
  const { data: res, isLoading, refetch } = useQuery({
    queryKey: getGetAdminBackupsQueryKey(),
    queryFn: () => getAdminBackups(),
  });

  const backups = (res?.status === 200 ? res.data : []) as BackupInfoDTO[];

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{t("backups.heading")}</h2>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="rounded-md border border-input p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          title={t("backups.refresh")}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {isLoading ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : backups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("backups.empty")}</p>
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
                <span>{b.createdAt ? new Date(b.createdAt).toLocaleString() : "-"}</span>
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
