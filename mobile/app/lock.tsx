// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
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
import { useAuth } from '../src/presentation/hooks/useAuth';
import { container } from '../src/container';
import { Logo } from '../src/presentation/components/Logo';

export default function LockScreen() {
  const router = useRouter();
  const { unlockWithBiometric, unlockWithPassword, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isBiometricEnrolled, setIsBiometricEnrolled] = useState(false);

  useEffect(() => {
    container.biometricService.isEnrolled().then(setIsBiometricEnrolled);
  }, []);

  async function handleBiometric() {
    setLoading(true);
    try {
      await unlockWithBiometric();
      router.replace('/(vault)');
    } catch (err) {
      Alert.alert('Biometric failed', 'Use your master password instead.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePassword() {
    if (!password.trim()) return;
    setLoading(true);
    try {
      await unlockWithPassword(password);
      router.replace('/(vault)');
    } catch (err) {
      Alert.alert(
        'Unlock failed',
        err instanceof Error ? err.message : 'Incorrect master password.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      Alert.alert(
        'Logout failed',
        'Could not remove biometric credential. Please try again.',
      );
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Logo />
        <Text style={styles.title}>Vault locked</Text>
        <Text style={styles.subtitle}>Unlock with your master password or biometrics.</Text>

        {isBiometricEnrolled && (
          <TouchableOpacity
            style={styles.biometricButton}
            onPress={handleBiometric}
            disabled={loading}
          >
            <Text style={styles.biometricText}>Unlock with Face ID / Touch ID</Text>
          </TouchableOpacity>
        )}

        <TextInput
          style={styles.input}
          placeholder="Master password"
          placeholderTextColor="#888"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={handlePassword}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handlePassword}
          disabled={loading || !password.trim()}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Unlock</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 14, color: '#aaa', marginBottom: 8 },
  biometricButton: {
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  biometricText: { color: '#2563eb', fontSize: 16, fontWeight: '600' },
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
  logoutButton: { alignItems: 'center', paddingVertical: 12 },
  logoutText: { color: '#666', fontSize: 14 },
});
