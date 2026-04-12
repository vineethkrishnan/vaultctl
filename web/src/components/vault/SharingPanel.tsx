import { useState, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Trash2, Shield } from "lucide-react";
import {
  deleteVaultsVaultIdMembersUserId,
} from "@/api/sharing/sharing";
import { getOrgsIdMembers, getGetOrgsIdMembersQueryKey } from "@/api/organizations/organizations";
import { useGetVaults } from "@/api/vaults/vaults";
import { useAuthStore } from "@/lib/auth-store";
import type { VaultResponse } from "@/api/model";

// The generated VaultResponse may not include orgId; extend locally.
type VaultWithOrg = VaultResponse & { orgId?: string };

type MemberEntry = { userId: string; role: string; acceptedAt?: string };

/**
 * SharingPanel — vault member management (M8).
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

  const { data: vaultsRes } = useGetVaults();
  const vault = useMemo((): VaultWithOrg | null => {
    if (!vaultsRes || vaultsRes.status !== 200) return null;
    return (vaultsRes.data.find((v) => v.id === vaultId) as VaultWithOrg) ?? null;
  }, [vaultsRes, vaultId]);

  const isShared = vault?.type === "shared";
  const orgId = vault?.orgId;

  const { data: membersRes, isLoading: membersLoading } = useQuery({
    queryKey: orgId ? getGetOrgsIdMembersQueryKey(orgId) : ["no-org"],
    queryFn: () => (orgId ? getOrgsIdMembers(orgId) : Promise.resolve({ status: 200, data: [] })),
    enabled: !!orgId,
  });

  const members = useMemo((): MemberEntry[] => {
    if (!membersRes) return [];
    const res = membersRes as { status: number; data?: MemberEntry[] };
    return res.status === 200 ? res.data ?? [] : [];
  }, [membersRes]);

  // Adding a member requires fetching the recipient's public key, wrapping
  // the vault key with RSA-OAEP, and signing the wrap with Ed25519 — all
  // client-side. This is not yet wired (needs the key-holder Worker to
  // support wrap+sign for an arbitrary recipient). The UI shows the member
  // list and remove controls; the "Add" action is disabled until the crypto
  // path is complete.
  const canAddMembers = false;

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
        {canAddMembers ? (
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
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Adding members requires client-side key wrapping which is not yet
            available in the web UI. Use the CLI or API to share vaults.
          </p>
        )}
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
