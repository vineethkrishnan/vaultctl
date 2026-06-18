// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useCallback } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { PinPad } from '../src/presentation/components/PinPad';
import { useAuth } from '../src/presentation/hooks/useAuth';

export default function SetPinScreen() {
  const router = useRouter();
  const { enablePin } = useAuth();
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleComplete = useCallback(
    async (pin: string) => {
      if (firstPin === null) {
        setError(null);
        setFirstPin(pin);
        return;
      }
      if (pin !== firstPin) {
        setError('PINs did not match. Try again.');
        setFirstPin(null);
        return;
      }
      setSaving(true);
      try {
        await enablePin(pin);
        router.back();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not set PIN.');
        setFirstPin(null);
      } finally {
        setSaving(false);
      }
    },
    [firstPin, enablePin, router],
  );

  return (
    <View style={styles.container}>
      <PinPad
        title={firstPin === null ? 'Set a 4-digit PIN' : 'Confirm your PIN'}
        subtitle={
          firstPin === null
            ? 'Used to unlock your vault on this device.'
            : 'Re-enter the same PIN to confirm.'
        }
        error={error}
        disabled={saving}
        onComplete={handleComplete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', padding: 24 },
});
