// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { container } from '../../container';
import { CreateItemInput, UpdateItemInput } from '../../application/dtos/ItemDtos';

export function useCreateItem(vaultId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateItemInput) => container.createItem.execute(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', vaultId] });
    },
  });
}

export function useUpdateItem(vaultId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateItemInput) => container.updateItem.execute(input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items', vaultId] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.itemId] });
    },
  });
}

export function useDeleteItem(vaultId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId }: { itemId: string }) => container.deleteItem.execute(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', vaultId] });
    },
  });
}

export function useRestoreItem(vaultId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId }: { itemId: string }) => container.restoreItem.execute(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', vaultId] });
    },
  });
}

export function useToggleFavorite(vaultId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, isFavorite }: { itemId: string; isFavorite: boolean }) =>
      container.toggleFavorite.execute(itemId, isFavorite),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['items', vaultId] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.itemId] });
    },
  });
}
