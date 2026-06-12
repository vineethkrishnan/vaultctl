// SPDX-License-Identifier: AGPL-3.0-or-later

// Install the Web Crypto polyfill before anything else loads.
// react-native-quick-crypto replaces globalThis.crypto.subtle with an
// OpenSSL-backed implementation so all shared AES-GCM / HKDF / RSA-OAEP /
// Ed25519 code from web/src/shared/crypto works unchanged in Hermes.
import { install } from 'react-native-quick-crypto';
install();

import 'expo-router/entry';
