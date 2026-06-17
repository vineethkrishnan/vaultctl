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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../src/presentation/hooks/useAuth';

export default function TotpScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const { submitTotp } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!code.trim() || !email) return;
    setLoading(true);
    try {
      await submitTotp(email, code, new Uint8Array(), '', []);
      router.replace('/(vault)');
    } catch (err) {
      Alert.alert(
        'Invalid code',
        err instanceof Error ? err.message : 'Check your authenticator and try again.',
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
        <Text style={styles.title}>Two-factor authentication</Text>
        <Text style={styles.subtitle}>Enter the 6-digit code from your authenticator app.</Text>

        <TextInput
          style={styles.input}
          placeholder="000000"
          placeholderTextColor="#888"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
          returnKeyType="go"
          onSubmitEditing={handleSubmit}
          textAlign="center"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading || code.length < 6}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Verify</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 14, color: '#aaa', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 18,
    fontSize: 28,
    fontWeight: '600',
    color: '#fff',
    backgroundColor: '#111',
    letterSpacing: 10,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
