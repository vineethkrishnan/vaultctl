// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTrash } from '../src/presentation/hooks/useTrash';
import { useRestoreItem, useDeleteItem } from '../src/presentation/hooks/useItemMutations';
import { ItemSummaryDto } from '../src/application/dtos/ItemDtos';
import { useQueryClient } from '@tanstack/react-query';

const TYPE_ICON: Record<string, string> = {
  login: 'L',
  secure_note: 'N',
  credit_card: 'C',
  identity: 'I',
  api_key: 'K',
  ssh_key: 'S',
  passkey: 'P',
};

function TrashRow({
  item,
  onRestore,
  onDelete,
}: {
  item: ItemSummaryDto;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const icon = TYPE_ICON[item.itemType] ?? '?';
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Text style={styles.rowIconText}>{icon}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.decryptedName ?? '(encrypted)'}
        </Text>
        <Text style={styles.rowMeta}>{item.itemType.replace('_', ' ')}</Text>
      </View>
      <TouchableOpacity onPress={onRestore} style={styles.actionBtn}>
        <Text style={styles.restoreText}>Restore</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDelete} style={styles.actionBtn}>
        <Text style={styles.deleteText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );
}

function TrashRowContainer({ item }: { item: ItemSummaryDto }) {
  const queryClient = useQueryClient();
  const { mutateAsync: restore } = useRestoreItem(item.vaultId);
  const { mutateAsync: deleteItem } = useDeleteItem(item.vaultId);

  async function handleRestore() {
    try {
      await restore({ itemId: item.id });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
    } catch {
      Alert.alert('Error', 'Failed to restore item.');
    }
  }

  function handleDelete() {
    Alert.alert('Permanently Delete', 'This cannot be undone. Delete this item permanently?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete Permanently',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteItem({ itemId: item.id });
            queryClient.invalidateQueries({ queryKey: ['trash'] });
          } catch {
            Alert.alert('Error', 'Failed to delete item.');
          }
        },
      },
    ]);
  }

  return <TrashRow item={item} onRestore={handleRestore} onDelete={handleDelete} />;
}

export default function TrashScreen() {
  const { data: trashed, isLoading, isError, refetch } = useTrash();

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#2563eb" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Failed to load trash</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={trashed ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TrashRowContainer item={item} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Trash is empty</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  errorText: { color: '#ef4444', fontSize: 14 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 8, backgroundColor: '#1a1a1a', borderRadius: 8 },
  retryText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
  empty: { paddingTop: 80, alignItems: 'center' },
  emptyText: { color: '#555', fontSize: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowIconText: { color: '#666', fontSize: 14, fontWeight: '700' },
  rowBody: { flex: 1, gap: 2 },
  rowName: { color: '#888', fontSize: 15, fontWeight: '500' },
  rowMeta: { color: '#444', fontSize: 12 },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#111', borderRadius: 7 },
  restoreText: { color: '#2563eb', fontSize: 12, fontWeight: '600' },
  deleteText: { color: '#ef4444', fontSize: 12, fontWeight: '600' },
});
