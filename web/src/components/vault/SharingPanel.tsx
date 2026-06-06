// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Trash2, Shield, Info } from "lucide-react";
import { deleteVaultsVaultIdMembersUserId } from "@/api/sharing/sharing";
import { getOrgsIdMembers, getGetOrgsIdMembersQueryKey } from "@/api/organizations/organizations";
import { useGetVaults } from "@/api/vaults/vaults";
import { useAuthStore } from "@/lib/auth-store";

/**
 * SharingPanel - vault member management (M8).
 *
 * Lists current vault members and allows adding/removing members for
 * shared vaults. Personal vaults show a prompt to convert to shared.
 * Uses the generated Orval hooks for type-safe API calls.
 */
export function SharingPanel() {
  const { t } = useTranslation(["vault", "common"]);
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };
  const currentUserId = useAuthStore((s) => s.userId);
  const queryClient = useQueryClient();

  // Fetch vault to check type + orgId
  const { data: vaultsRes } = useGetVaults();
  const vault = useMemo(() => {
    if (!vaultsRes || vaultsRes.status !== 200) return null;
    return vaultsRes.data.find((v) => v.id === vaultId) ?? null;
  }, [vaultsRes, vaultId]);

  const isShared = vault?.type === "shared";
  const orgId = (vault as any)?.orgId as string | undefined;

  // Fetch org members (only for shared vaults with orgId).
  // The non-null assertion is safe: the query is disabled until orgId exists.
  const { data: membersRes, isLoading: membersLoading } = useQuery({
    queryKey: orgId ? getGetOrgsIdMembersQueryKey(orgId) : getGetOrgsIdMembersQueryKey(""),
    queryFn: () => getOrgsIdMembers(orgId!),
    enabled: !!orgId,
  });

  const members = useMemo(() => {
    if (!membersRes || (membersRes as any).status !== 200) return [];
    return ((membersRes as any).data ?? []) as Array<{
      userId: string;
      role: string;
      acceptedAt?: string;
    }>;
  }, [membersRes]);

  // Remove member mutation
  const removeMember = useMutation({
    mutationFn: (userId: string) => deleteVaultsVaultIdMembersUserId(vaultId, userId),
    onSuccess: () => {
      if (orgId) {
        queryClient.invalidateQueries({ queryKey: getGetOrgsIdMembersQueryKey(orgId) });
      }
    },
  });

  if (!isShared) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">{t("vault:sharing.heading")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("vault:sharing.personalVaultNote")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">{t("vault:sharing.members")}</h2>
        <span className="text-xs text-muted-foreground">
          ({members.length})
        </span>
      </div>

      {/* Member list */}
      {membersLoading ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("vault:sharing.noMembers")}</p>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            return (
              <li
                key={m.userId}
                className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono text-xs">{m.userId}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {m.role}
                  </span>
                  {isSelf && (
                    <span className="text-xs text-muted-foreground">{t("vault:sharing.you")}</span>
                  )}
                </div>
                {!isSelf && (
                  <button
                    type="button"
                    onClick={() => removeMember.mutate(m.userId)}
                    disabled={removeMember.isPending}
                    className="rounded-md border border-input p-1 text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50"
                    title={t("vault:sharing.removeMember")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Add member - disabled until key-wrap sharing lands (UX-2). Posting
          empty key material would invite a member who can never decrypt. */}
      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">{t("vault:sharing.addMember")}</span>
        </div>
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              {t("vault:sharing.comingSoonTitle")}
            </p>
            <p>{t("vault:sharing.comingSoonNote")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
