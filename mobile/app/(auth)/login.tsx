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
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';

import { prelogin, login } from '../../src/api/auth';
import { deriveKeys } from '../../src/crypto/kdf';
import { initKeys } from '../../src/store/keys';
import { useAuthStore } from '../../src/store/auth';
import { isBiometricAvailable, enrollBiometric } from '../../src/biometric';
import { syncAll } from '../../src/sync/engine';
import { fromBase64, toBase64 } from '@vaultctl/shared/crypto/utils';

export default function LoginScreen() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) return;
    setLoading(true);

    try {
      const preloginData = await prelogin(email.trim().toLowerCase());

      const salt = fromBase64(preloginData.salt);
      const { authHash, stretchedKey } = await deriveKeys(password, salt, {
        iterations: preloginData.iterations,
        memoryKB: preloginData.memoryKB,
        parallelism: preloginData.parallelism,
      });

      const { data, status } = await login({
        email: email.trim().toLowerCase(),
        authHash: toBase64(authHash),
      });

      if (status === 423) {
        // TOTP required
        router.push({
          pathname: '/(auth)/totp',
          params: { email: email.trim().toLowerCase() },
        });
        return;
      }

      if (status !== 200) {
        Alert.alert('Login failed', 'Invalid email or password.');
        return;
      }

      await setAuth({
        userId: data.userId,
        role: data.role,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        sessionId: data.sessionId,
      });

      await initKeys({
        stretchedKey,
        encryptedPrivateKey: data.encryptedPrivateKey,
        vaults: data.vaults,
      });

      const canUseBiometrics = await isBiometricAvailable();
      if (canUseBiometrics) {
        try {
          await enrollBiometric({
            stretchedKey,
            encryptedPrivateKey: data.encryptedPrivateKey,
            vaults: data.vaults,
          });
        } catch {
          // User cancelled enrollment; proceed without biometrics.
        }
      }

      // Kick off a background sync immediately after first login.
      syncAll().catch(() => {});

      router.replace('/(vault)');
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Something went wrong.',
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
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Sign In</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#888"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="next"
        />

        <TextInput
          style={styles.input}
          placeholder="Master Password"
          placeholderTextColor="#888"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading || !email.trim() || !password.trim()}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 14, paddingVertical: 40 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 8 },
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
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
