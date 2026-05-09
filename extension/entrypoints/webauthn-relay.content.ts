// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAuthn relay — v1 observer stub.
 *
 * Runs at document_start in the MAIN world so it can monkey-patch
 * `navigator.credentials.create` and `navigator.credentials.get` before
 * any page script captures a reference to them.
 *
 * v1 behaviour: observe the call, dispatch a CustomEvent with the options,
 * and PROXY through to the real browser WebAuthn API unchanged. We do not
 * yet handle the credential ourselves — that is a v1.1 item once the relay
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
    if (typeof navigator === "undefined" || !navigator.credentials) return;

    const observed: NonNullable<Window["__vaultctlWebAuthnSeen"]> = [];
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
    // swallow — some pages freeze CustomEvent; non-fatal for the stub
  }
}
