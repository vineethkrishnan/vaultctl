// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Trash2, Shield } from "lucide-react";
import {
  postVaultsVaultIdMembers,
  deleteVaultsVaultIdMembersUserId,
} from "@/api/sharing/sharing";
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
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };
  const currentUserId = useAuthStore((s) => s.userId);
  const queryClient = useQueryClient();

  const [recipientId, setRecipientId] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  // Add member mutation
  const addMember = useMutation({
    mutationFn: async () => {
      // The full sharing flow requires fetching the recipient's public key,
      // wrapping the vault key, and signing it. For now, this sends the
      // request - the server validates the crypto contract.
      return postVaultsVaultIdMembers(vaultId, {
        recipientUserId: recipientId,
        role,
        encryptedVaultKey: "", // placeholder - real implementation requires key wrapping
        wrapSignature: "",
      });
    },
    onSuccess: () => {
      setSuccess(`Invited ${recipientId} as ${role}`);
      setRecipientId("");
      setError(null);
      if (orgId) {
        queryClient.invalidateQueries({ queryKey: getGetOrgsIdMembersQueryKey(orgId) });
      }
    },
    onError: (err: Error) => {
      setError(err.message);
      setSuccess(null);
    },
  });

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
          <h2 className="font-semibold">Sharing</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          This is a personal vault. To share items with others, create a
          shared vault and move items into it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Members</h2>
        <span className="text-xs text-muted-foreground">
          ({members.length})
        </span>
      </div>

      {/* Member list */}
      {membersLoading ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
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
                    <span className="text-xs text-muted-foreground">(you)</span>
                  )}
                </div>
                {!isSelf && (
                  <button
                    type="button"
                    onClick={() => removeMember.mutate(m.userId)}
                    disabled={removeMember.isPending}
                    className="rounded-md border border-input p-1 text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50"
                    title="Remove member"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Add member form */}
      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">Add member</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            placeholder="User ID"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={() => addMember.mutate()}
            disabled={!recipientId.trim() || addMember.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-500">{success}</p>
        )}
      </div>
    </div>
  );
}
