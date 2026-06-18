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

config.resolver.sourceExts = [
  'ts',
  'tsx',
  'mts',
  'js',
  'jsx',
  'json',
  'cjs',
];

// The shared crypto package (web/src/shared) uses ESM-style ".js" import
// specifiers that actually point at ".ts" sources. tsc and jest resolve those,
// but Metro looks for the literal ".js" file and fails. Fall back to the
// extensionless counterpart (resolved via sourceExts -> .ts) when a ".js"
// specifier does not resolve directly.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    if (moduleName.endsWith('.js')) {
      return context.resolveRequest(context, moduleName.replace(/\.js$/, ''), platform);
    }
    throw error;
  }
};

module.exports = config;
