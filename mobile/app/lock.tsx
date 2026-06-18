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
import { PinPad } from '../src/presentation/components/PinPad';

function lockedMessage(lockedUntilMs: number): string {
  const seconds = Math.max(1, Math.ceil((lockedUntilMs - Date.now()) / 1000));
  if (seconds < 60) return `Too many attempts. Try again in ${seconds}s.`;
  const minutes = Math.ceil(seconds / 60);
  return `Too many attempts. Try again in ${minutes} min.`;
}

export default function LockScreen() {
  const router = useRouter();
  const { unlockWithBiometric, unlockWithPassword, unlockWithPin, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isBiometricEnrolled, setIsBiometricEnrolled] = useState(false);
  const [isPinSet, setIsPinSet] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    container.biometricService.isEnrolled().then(setIsBiometricEnrolled);
    container.pinService.isSet().then(setIsPinSet);
  }, []);

  async function handlePinComplete(pin: string) {
    setLoading(true);
    setPinError(null);
    try {
      await unlockWithPin(pin);
      router.replace('/(vault)');
    } catch (err) {
      const failure = err as { name?: string; attemptsRemaining?: number; lockedUntilMs?: number };
      if (failure.name === 'PinLockedError' && failure.lockedUntilMs) {
        setPinError(lockedMessage(failure.lockedUntilMs));
      } else if (failure.name === 'PinWrongError') {
        setPinError(`Wrong PIN. ${failure.attemptsRemaining ?? 0} attempts left.`);
      } else {
        setPinError(err instanceof Error ? err.message : 'Could not unlock with PIN.');
      }
    } finally {
      setLoading(false);
    }
  }

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

        {pinMode ? (
          <>
            <PinPad
              title="Enter your PIN"
              error={pinError}
              disabled={loading}
              onComplete={handlePinComplete}
            />
            <TouchableOpacity
              style={styles.logoutButton}
              onPress={() => {
                setPinMode(false);
                setPinError(null);
              }}
            >
              <Text style={styles.logoutText}>Use master password</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
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

            {isPinSet && (
              <TouchableOpacity
                style={styles.biometricButton}
                onPress={() => setPinMode(true)}
                disabled={loading}
              >
                <Text style={styles.biometricText}>Unlock with PIN</Text>
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
          </>
        )}
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
