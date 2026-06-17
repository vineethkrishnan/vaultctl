// SPDX-License-Identifier: AGPL-3.0-or-later

import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useFavorites } from '../src/presentation/hooks/useFavorites';
import { ItemSummaryDto } from '../src/application/dtos/ItemDtos';

const TYPE_ICON: Record<string, string> = {
  login: 'L',
  secure_note: 'N',
  credit_card: 'C',
  identity: 'I',
  api_key: 'K',
  ssh_key: 'S',
  passkey: 'P',
};

function FavoriteRow({ item, onPress }: { item: ItemSummaryDto; onPress: () => void }) {
  const icon = TYPE_ICON[item.itemType] ?? '?';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <Text style={styles.rowIconText}>{icon}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.decryptedName ?? '(encrypted)'}
        </Text>
        <Text style={styles.rowMeta}>{item.itemType.replace('_', ' ')}</Text>
      </View>
      <Text style={styles.star}>*</Text>
      <Text style={styles.chevron}>{'>'}</Text>
    </TouchableOpacity>
  );
}

export default function FavoritesScreen() {
  const router = useRouter();
  const { data: favorites, isLoading, isError, refetch } = useFavorites();

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
        <Text style={styles.errorText}>Failed to load favorites</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={favorites ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <FavoriteRow
            item={item}
            onPress={() =>
              router.push(
                `/(vault)/${item.vaultId}/${item.id}` as Parameters<typeof router.push>[0],
              )
            }
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No favorite items yet</Text>
            <Text style={styles.emptyHint}>Tap the Favorite button on an item to add it here</Text>
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
  empty: { paddingTop: 80, alignItems: 'center', gap: 10 },
  emptyText: { color: '#555', fontSize: 16 },
  emptyHint: { color: '#333', fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },
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
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowIconText: { color: '#2563eb', fontSize: 14, fontWeight: '700' },
  rowBody: { flex: 1, gap: 2 },
  rowName: { color: '#e5e5e5', fontSize: 15, fontWeight: '500' },
  rowMeta: { color: '#555', fontSize: 12 },
  star: { color: '#ca8a04', fontSize: 16 },
  chevron: { color: '#444', fontSize: 16 },
});
