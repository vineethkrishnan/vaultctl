// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAuthn relay - v1 observer stub.
 *
 * Runs at document_start in the MAIN world so it can monkey-patch
 * `navigator.credentials.create` and `navigator.credentials.get` before
 * any page script captures a reference to them.
 *
 * v1 behaviour: observe the call, dispatch a CustomEvent with the options,
 * and PROXY through to the real browser WebAuthn API unchanged. We do not
 * yet handle the credential ourselves - that is a v1.1 item once the relay
 * channel and passkey storage have been designed. The acceptance bar for
 * this milestone is "the interceptor is reached and observed".
 *
 * Notes on world isolation:
 *   - MAIN-world content scripts do not have access to `browser.runtime`,
 *     so we cannot call `sendMessage` from here. We dispatch a CustomEvent
 *     that the isolated-world content script (content.ts) will pick up
 *     and forward to the background in v1.1.
 *   - A `window.__vaultctlWebAuthnSeen` array is exposed so DevTools and
 *     tests can verify the interception path ran.
 */

import { ContentScriptContext } from "wxt/utils/content-script-context";

declare global {
  interface Window {
    __vaultctlWebAuthnSeen?: Array<{
      method: "create" | "get";
      timestamp: number;
      origin: string;
    }>;
  }
}

export default defineContentScript({
  matches: ["https://*/*"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    // MAIN-world content scripts receive no ctx argument from WXT, so build one
    // to hook onInvalidated and restore the original WebAuthn API on reload.
    const ctx = new ContentScriptContext("webauthn-relay");

    // The relay is a v1 observer stub with no current feature value. It
    // monkey-patches navigator.credentials on every https page and exposes a
    // page-readable install fingerprint, so it ships DISABLED by default and
    // only runs in a dev build. Production users get the unmodified browser API.
    if (!import.meta.env.DEV) return;
    if (typeof navigator === "undefined" || !navigator.credentials) return;

    const observed: NonNullable<Window["__vaultctlWebAuthnSeen"]> = [];
    // Only exposed in dev so production pages cannot read it as an install
    // fingerprint.
    window.__vaultctlWebAuthnSeen = observed;

    const originalCreate = navigator.credentials.create?.bind(
      navigator.credentials,
    );
    const originalGet = navigator.credentials.get?.bind(navigator.credentials);

    if (originalCreate) {
      navigator.credentials.create = async function patchedCreate(
        options?: CredentialCreationOptions,
      ): Promise<Credential | null> {
        if (options && "publicKey" in options && options.publicKey) {
          observed.push({
            method: "create",
            timestamp: Date.now(),
            origin: window.location.origin,
          });
          dispatchRelayEvent("create", options.publicKey);
        }
        return originalCreate(options);
      };
    }

    if (originalGet) {
      navigator.credentials.get = async function patchedGet(
        options?: CredentialRequestOptions,
      ): Promise<Credential | null> {
        if (options && "publicKey" in options && options.publicKey) {
          observed.push({
            method: "get",
            timestamp: Date.now(),
            origin: window.location.origin,
          });
          dispatchRelayEvent("get", options.publicKey);
        }
        return originalGet(options);
      };
    }

    // On extension reload/update the patched functions would otherwise outlive
    // the relay, leaking the override into a dead context. Restore the originals
    // and remove the global when the content script is invalidated.
    ctx.onInvalidated(() => {
      if (originalCreate) navigator.credentials.create = originalCreate;
      if (originalGet) navigator.credentials.get = originalGet;
      try {
        delete window.__vaultctlWebAuthnSeen;
      } catch {
        window.__vaultctlWebAuthnSeen = undefined;
      }
    });
  },
});

function dispatchRelayEvent(
  method: "create" | "get",
  publicKey: unknown,
): void {
  try {
    window.dispatchEvent(
      new CustomEvent("vaultctl:webauthn", {
        detail: { method, origin: window.location.origin, publicKey },
      }),
    );
  } catch {
    // swallow - some pages freeze CustomEvent; non-fatal for the stub
  }
}
