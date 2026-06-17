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
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { submitTotp } from '../../src/api/auth';
import { useAuthStore } from '../../src/store/auth';
import { syncAll } from '../../src/sync/engine';

export default function TotpScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const { setAuth } = useAuthStore();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (code.length !== 6) return;
    setLoading(true);

    try {
      const { data, status } = await submitTotp({ email, code });

      if (status !== 200) {
        Alert.alert('Invalid code', 'Check your authenticator app and try again.');
        return;
      }

      await setAuth({
        userId: data.userId,
        role: data.role,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        sessionId: data.sessionId,
      });

      syncAll().catch(() => {});
      router.replace('/(vault)');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Two-Factor Authentication</Text>
      <Text style={styles.subtitle}>
        Enter the 6-digit code from your authenticator app.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="000000"
        placeholderTextColor="#888"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
        textAlign="center"
        maxLength={6}
      />

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={loading || code.length !== 6}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 15, color: '#aaa' },
  input: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 28,
    letterSpacing: 8,
    color: '#fff',
    backgroundColor: '#111',
  },
  button: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 15, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
