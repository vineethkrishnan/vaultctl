// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { generateTotp, parseTotp, secondsRemaining } from '@vaultctl/shared/totp/totp';

interface Props {
  uri: string;
}

export function TotpCounter({ uri }: Props) {
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;

    function tick() {
      if (!mounted) return;
      try {
        const params = parseTotp(uri);
        const remaining = secondsRemaining(params.period);
        generateTotp(params).then((totp) => {
          if (!mounted) return;
          setCode(totp);
          setSecondsLeft(Math.round(remaining));
        });
      } catch {
        setCode('ERROR');
      }
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [uri]);

  async function handleCopy() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isExpiring = secondsLeft <= 5;

  return (
    <TouchableOpacity onPress={handleCopy} style={styles.container}>
      <Text style={[styles.code, isExpiring && styles.expiring]}>
        {code.slice(0, 3)} {code.slice(3)}
      </Text>
      <Text style={[styles.timer, isExpiring && styles.expiring]}>{secondsLeft}s</Text>
      {copied && <Text style={styles.copied}>Copied</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
  },
  code: { fontSize: 28, fontWeight: '700', color: '#2563eb', letterSpacing: 4 },
  timer: { fontSize: 14, color: '#666' },
  expiring: { color: '#ef4444' },
  copied: { fontSize: 12, color: '#22c55e', marginLeft: 'auto' },
});
