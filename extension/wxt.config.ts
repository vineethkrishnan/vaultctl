// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from "wxt";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";

// Resolve the shared crypto module that lives under web/src/shared/crypto.
// The extension reuses the M6 TS crypto primitives rather than duplicating them.
const thisDir = dirname(fileURLToPath(import.meta.url));
const sharedCryptoDir = resolve(thisDir, "../web/src/shared/crypto");
// The RFC-6238 TOTP generator is shared with the web client (same secret wire
// shape), reused here rather than reimplemented.
const sharedTotpEntry = resolve(thisDir, "../web/src/shared/totp/totp.ts");
// hash-wasm is declared as a dep of extension/package.json but the shared
// crypto module lives outside extension/, so the bundler cannot walk
// node_modules from the importer - alias it explicitly.
const hashWasmEntry = resolve(
  thisDir,
  "node_modules/hash-wasm/dist/index.esm.js",
);

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifestVersion: 3,
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@shared/crypto": resolve(sharedCryptoDir, "index.ts"),
        "@shared/crypto/": `${sharedCryptoDir}/`,
        "@shared/totp": sharedTotpEntry,
        "hash-wasm": hashWasmEntry,
      },
    },
  }),
  manifest: {
    name: "VaultCTL: Password Vault",
    description:
      "Self-hosted, zero-knowledge password manager: autofill, capture and generate logins, all encrypted in your browser.",
    homepage_url: "https://vaultctl.vinelabs.de",
    icons: {
      16: "/icon/icon-16.png",
      32: "/icon/icon-32.png",
      48: "/icon/icon-48.png",
      128: "/icon/icon-128.png",
    },
    action: {
      default_icon: {
        16: "/icon/icon-16.png",
        32: "/icon/icon-32.png",
        48: "/icon/icon-48.png",
        128: "/icon/icon-128.png",
      },
    },
    // Argon2id (hash-wasm) runs in the popup; MV3 extension pages need an
    // explicit opt-in for WebAssembly. 'wasm-unsafe-eval' permits WASM only,
    // not general eval.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    permissions: [
      "activeTab",
      "storage",
      "clipboardWrite",
      // Read-back before the auto-clear wipes the clipboard, so we only clear it
      // when it still holds the copied secret (never destroy unrelated content).
      "clipboardRead",
      "notifications",
      "scripting",
      // Right-click "Fill from vaultctl" on editable fields.
      "contextMenus",
    ],
    host_permissions: ["<all_urls>"],
    // Keyboard shortcut to open the fill picker on the focused field.
    commands: {
      "fill-login": {
        suggested_key: {
          default: "Ctrl+Shift+L",
          mac: "Command+Shift+L",
        },
        description: "Fill a login from vaultctl",
      },
    },
    browser_specific_settings: {
      gecko: {
        id: "vaultctl@vineethkrishnan.dev",
        strict_min_version: "115.0",
      },
    },
  },
});
