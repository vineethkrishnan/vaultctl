// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  StyleSheet,
  SectionList,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useItems } from '../../../src/presentation/hooks/useItems';
import { ItemSummaryDto } from '../../../src/application/dtos/ItemDtos';

const TYPE_ICON: Record<string, string> = {
  login: 'L',
  secure_note: 'N',
  credit_card: 'C',
  identity: 'I',
  api_key: 'K',
  ssh_key: 'S',
  passkey: 'P',
};

const TYPE_COLOR: Record<string, string> = {
  login: '#1d4ed8',
  secure_note: '#a16207',
  credit_card: '#15803d',
  identity: '#7e22ce',
  api_key: '#b91c1c',
  ssh_key: '#0e7490',
  passkey: '#9a3412',
};

function ItemRow({ item, onPress }: { item: ItemSummaryDto; onPress: () => void }) {
  const color = TYPE_COLOR[item.itemType] ?? '#333';
  const icon = TYPE_ICON[item.itemType] ?? '?';
  const name = item.decryptedName ?? '(encrypted)';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.rowIcon, { backgroundColor: color + '33' }]}>
        <Text style={[styles.rowIconText, { color }]}>{icon}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.rowMeta}>{item.itemType.replace('_', ' ')}</Text>
      </View>
      {item.isFavorite && <Text style={styles.star}>*</Text>}
      <Text style={styles.chevron}>{'>'}</Text>
    </TouchableOpacity>
  );
}

type Section = { title: string; data: ItemSummaryDto[] };

export default function ItemListScreen() {
  const { vaultId } = useLocalSearchParams<{ vaultId: string }>();
  const router = useRouter();
  const { data: items, isLoading, isError, refetch, syncAndRefresh } = useItems(vaultId!);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await syncAndRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  const sections: Section[] = useMemo(() => {
    const all = items ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter((item) => (item.decryptedName ?? '').toLowerCase().includes(q))
      : all;

    const noFolder = filtered.filter((i) => !i.folderId && !i.isTrashed);
    const byFolder: Record<string, ItemSummaryDto[]> = {};
    for (const item of filtered) {
      if (item.folderId && !item.isTrashed) {
        (byFolder[item.folderId] ??= []).push(item);
      }
    }

    const result: Section[] = [];
    if (noFolder.length > 0) result.push({ title: 'Items', data: noFolder });
    for (const [folderId, folderItems] of Object.entries(byFolder)) {
      result.push({ title: folderId, data: folderItems });
    }
    return result;
  }, [items, query]);

  if (isLoading && !items) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>Loading...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Failed to load items</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.fab}
        onPress={() =>
          router.push(`/(vault)/${vaultId}/new` as Parameters<typeof router.push>[0])
        }
        activeOpacity={0.85}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search..."
          placeholderTextColor="#555"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ItemRow
            item={item}
            onPress={() =>
              router.push(
                `/(vault)/${vaultId}/${item.id}` as Parameters<typeof router.push>[0],
              )
            }
          />
        )}
        renderSectionHeader={({ section }) =>
          sections.length > 1 ? (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#2563eb"
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.centerText}>
              {query ? 'No items match your search' : 'No items in this vault'}
            </Text>
          </View>
        }
        contentContainerStyle={sections.length === 0 ? styles.emptyContainer : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, paddingTop: 60 },
  emptyContainer: { flex: 1 },
  centerText: { color: '#aaa', fontSize: 14 },
  errorText: { color: '#ef4444', fontSize: 14 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 8, backgroundColor: '#1a1a1a', borderRadius: 8 },
  retryText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  searchInput: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#e5e5e5',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#222',
  },
  sectionHeader: {
    backgroundColor: '#0f0f0f',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  sectionTitle: { color: '#666', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowIconText: { fontSize: 15, fontWeight: '700' },
  rowBody: { flex: 1, gap: 2 },
  rowName: { color: '#e5e5e5', fontSize: 15, fontWeight: '500' },
  rowMeta: { color: '#555', fontSize: 12 },
  star: { color: '#ca8a04', fontSize: 14 },
  chevron: { color: '#444', fontSize: 16 },
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '300' },
});
