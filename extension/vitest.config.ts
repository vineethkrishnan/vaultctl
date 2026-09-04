// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Mirrors the @shared aliases in wxt.config.ts so a util under test resolves
// the shared modules the same way the bundled extension does.
const thisDir = dirname(fileURLToPath(import.meta.url));
const sharedDir = resolve(thisDir, "../web/src/shared");

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["utils/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@shared/crypto": resolve(sharedDir, "crypto/index.ts"),
      "@shared/host": resolve(sharedDir, "host/index.ts"),
      "@shared/totp": resolve(sharedDir, "totp/totp.ts"),
      "@shared/webauthn": resolve(sharedDir, "webauthn/index.ts"),
    },
  },
});
