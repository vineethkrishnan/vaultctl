// SPDX-License-Identifier: AGPL-3.0-or-later

import { Image, StyleSheet, View } from 'react-native';

const ASPECT_RATIO = 810 / 954;

export function Logo({ width = 150 }: { width?: number }) {
  return (
    <View style={styles.wrap}>
      <Image
        source={require('../../../assets/logo.png')}
        style={{ width, height: width * ASPECT_RATIO }}
        resizeMode="contain"
        accessibilityLabel="Vault CTL"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginBottom: 24 },
});
