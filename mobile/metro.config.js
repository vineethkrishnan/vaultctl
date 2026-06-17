// SPDX-License-Identifier: AGPL-3.0-or-later

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Let Metro see the repo root so shared code is accessible.
config.watchFolders = [repoRoot];

// When resolving node_modules, prefer the mobile project's own
// node_modules first, then fall back to the repo root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
];

// Map @vaultctl/shared to the web app's shared directory.
// Metro resolves relative imports inside those files correctly.
config.resolver.extraNodeModules = {
  '@vaultctl/shared': path.resolve(repoRoot, 'web/src/shared'),
};

// Metro in Expo already resolves .js imports to .ts counterparts, but
// make the sourceExts explicit so TypeScript files in watchFolders are
// picked up correctly.
config.resolver.sourceExts = [
  'ts',
  'tsx',
  'mts',
  'js',
  'jsx',
  'json',
  'cjs',
];

module.exports = config;
