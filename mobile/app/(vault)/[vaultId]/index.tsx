// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  RefreshControl,
} from 'react-native';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import type { ItemResponse } from '@vaultctl/shared/types/api';
import { listItems } from '../../../src/sync/db';
import { syncVault } from '../../../src/sync/engine';
import { decryptName } from '../../../src/store/keys';

const ITEM_TYPE_ICON: Record<string, string> = {
  login: '🔑',
  secure_note: '📝',
  credit_card: '💳',
  identity: '🪪',
  api_key: '🔐',
  ssh_key: '🖥️',
  passkey: '🛡️',
};

interface DecryptedItem {
  id: string;
  vaultId: string;
  itemType: string;
  name: string;
  updatedAt: string;
  favorite: boolean;
}

export default function ItemListScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { vaultId } = useLocalSearchParams<{ vaultId: string }>();
  const [items, setItems] = useState<DecryptedItem[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadItems = useCallback(async () => {
    const raw = await listItems(vaultId, false);
    const decrypted = await Promise.all(
      raw.map(async (item) => {
        try {
          const name = await decryptName(item.vaultId, item.encryptedName);
          return {
            id: item.id,
            vaultId: item.vaultId,
            itemType: item.itemType,
            name,
            updatedAt: item.updatedAt,
            favorite: item.favorite,
          };
        } catch {
          return {
            id: item.id,
            vaultId: item.vaultId,
            itemType: item.itemType,
            name: '(encrypted)',
            updatedAt: item.updatedAt,
            favorite: item.favorite,
          };
        }
      }),
    );
    decrypted.sort((a, b) => a.name.localeCompare(b.name));
    setItems(decrypted);
  }, [vaultId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await syncVault(vaultId);
      await loadItems();
    } finally {
      setRefreshing(false);
    }
  }

  const filtered = search.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search items..."
        placeholderTextColor="#666"
        value={search}
        onChangeText={setSearch}
        clearButtonMode="while-editing"
      />

      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() =>
              router.push({
                pathname: `/(vault)/${vaultId}/${item.id}`,
              })
            }
          >
            <Text style={styles.icon}>{ITEM_TYPE_ICON[item.itemType] ?? '🔒'}</Text>
            <View style={styles.rowContent}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.type}>{item.itemType.replace('_', ' ')}</Text>
            </View>
            {item.favorite && <Text style={styles.star}>★</Text>}
          </TouchableOpacity>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#fff" />
        }
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {search ? 'No items match your search.' : 'No items. Pull to refresh.'}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  search: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
    gap: 12,
  },
  icon: { fontSize: 22, width: 32, textAlign: 'center' },
  rowContent: { flex: 1 },
  name: { color: '#fff', fontSize: 15, fontWeight: '500' },
  type: { color: '#888', fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  star: { color: '#f59e0b', fontSize: 14 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  empty: { color: '#555', fontSize: 15 },
});
