// SPDX-License-Identifier: AGPL-3.0-or-later
// Placeholder - rebuilt in M04

import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';

export default function VaultListScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator color="#2563eb" />
      <Text style={styles.text}>Loading vaults...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', gap: 16 },
  text: { color: '#aaa', fontSize: 14 },
});
