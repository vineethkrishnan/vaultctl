// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/presentation/hooks/useAuth';

export default function ServerScreen() {
  const router = useRouter();
  const { configureServer } = useAuth();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    const trimmed = url.trim().replace(/\/$/, '');
    if (!trimmed) return;
    setLoading(true);
    try {
      const res = await fetch(`${trimmed}/api/v1/health`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      await configureServer(trimmed);
      router.replace('/(auth)/login');
    } catch (err) {
      Alert.alert(
        'Cannot reach server',
        err instanceof Error ? err.message : 'Check the URL and try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>vaultctl</Text>
        <Text style={styles.subtitle}>Enter your self-hosted server URL to get started.</Text>

        <TextInput
          style={styles.input}
          placeholder="https://vault.example.com"
          placeholderTextColor="#888"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={handleConnect}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={loading || !url.trim()}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          vaultctl is a self-hosted password manager. You need your own server to use this app.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  title: { fontSize: 36, fontWeight: '700', color: '#fff', textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#aaa', textAlign: 'center', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#fff',
    backgroundColor: '#111',
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 12, color: '#555', textAlign: 'center', marginTop: 8 },
});
