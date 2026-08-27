// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAuthn relay.
 *
 * Runs at document_start in the MAIN world so it can replace
 * navigator.credentials.create/get before any page script captures a
 * reference to them. When the vault can serve a ceremony it does; otherwise
 * every path falls back to the browser's own implementation, so turning the
 * feature off, locking the vault, or meeting an unsupported request leaves the
 * page exactly as it would have been.
 *
 * World isolation: a MAIN-world script has no access to browser.runtime, so it
 * talks to the isolated-world content script over window.postMessage and that
 * script relays to the background. The page can read those messages, but they
 * carry nothing it is not already entitled to - the attestation object and the
 * assertion are the return values of the very call it made, and the private key
 * never leaves the service worker. A forged reply would only let a page lie to
 * itself.
 */

import { ContentScriptContext } from "wxt/utils/content-script-context";
import { fromBase64Url, toBase64Url } from "@shared/webauthn";
import {
  assertionCredentialJSON,
  attestationCredentialJSON,
  isSupportedRequest,
  ATTACHMENT,
  TRANSPORTS,
} from "../utils/webauthn-request";

const REQUEST_CHANNEL = "vaultctl:webauthn:request";
const RESPONSE_CHANNEL = "vaultctl:webauthn:response";

// How long to wait for the isolated-world bridge to answer a readiness probe.
// If our own content script is not there, this is the fallback path, so it has
// to be short enough that the page does not visibly stall.
const READY_TIMEOUT_MS = 1500;

// A ceremony waits on a human, so it gets the relying party's own timeout with
// a floor, rather than the probe's.
const MIN_CEREMONY_TIMEOUT_MS = 60_000;

const COSE_ES256 = -7;

interface BridgeReply {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export default defineContentScript({
  matches: ["https://*/*"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    // MAIN-world content scripts receive no ctx argument from WXT, so build one
    // to hook onInvalidated and restore the original WebAuthn API on reload.
    const ctx = new ContentScriptContext("webauthn-relay");

    if (typeof navigator === "undefined" || !navigator.credentials) return;

    const originalCreate = navigator.credentials.create?.bind(
      navigator.credentials,
    );
    const originalGet = navigator.credentials.get?.bind(navigator.credentials);
    const originalIsUvpaa =
      typeof PublicKeyCredential !== "undefined"
        ? PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.bind(
            PublicKeyCredential,
          )
        : undefined;

    if (originalCreate) {
      navigator.credentials.create = async function patchedCreate(
        options?: CredentialCreationOptions,
      ): Promise<Credential | null> {
        const publicKey = options?.publicKey;
        try {
          if (!publicKey || !(await canServe(options))) {
            return originalCreate(options);
          }
          const reply = await requestCeremony("create", publicKey.timeout, {
            rpId: publicKey.rp?.id ?? "",
            rpName: publicKey.rp?.name ?? "",
            challenge: encode(publicKey.challenge),
            userHandle: encode(publicKey.user?.id),
            userName: publicKey.user?.name ?? "",
            userDisplayName: publicKey.user?.displayName ?? "",
            discoverable: wantsDiscoverable(publicKey),
          });
          if (!reply?.ok) {
            if (reply?.error === "cancelled") throw cancelled();
            return originalCreate(options);
          }
          return buildAttestationCredential(reply, publicKey);
        } catch (err) {
          // A cancel is the user's answer, not a failure to serve: falling back
          // here would pop the browser's own dialog the moment they dismissed
          // ours. Every other error still hands the ceremony over.
          if (isCancellation(err)) throw err;
          return originalCreate(options);
        }
      };
    }

    if (originalGet) {
      navigator.credentials.get = async function patchedGet(
        options?: CredentialRequestOptions,
      ): Promise<Credential | null> {
        const publicKey = options?.publicKey;
        try {
          if (!publicKey || !(await canServe(options))) {
            return originalGet(options);
          }
          const reply = await requestCeremony("get", publicKey.timeout, {
            rpId: publicKey.rpId ?? "",
            challenge: encode(publicKey.challenge),
            allowCredentials: (publicKey.allowCredentials ?? []).map(
              (descriptor) => encode(descriptor.id),
            ),
          });
          if (!reply?.ok) {
            if (reply?.error === "cancelled") throw cancelled();
            return originalGet(options);
          }
          return buildAssertionCredential(reply);
        } catch (err) {
          if (isCancellation(err)) throw err;
          return originalGet(options);
        }
      };
    }

    if (typeof PublicKeyCredential !== "undefined") {
      // Relying parties gate the whole passkey path on these, so a browser with
      // no platform authenticator of its own would otherwise never offer to use
      // ours. Both stay truthful: the browser's answer still wins when it is
      // yes, and ours only adds a yes when the vault can actually serve.
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable =
        async function patchedIsUvpaa(): Promise<boolean> {
          try {
            if (await isReady()) return true;
          } catch {
            // fall through to the browser's own answer
          }
          return originalIsUvpaa ? originalIsUvpaa() : false;
        };
    }

    ctx.onInvalidated(() => {
      if (originalCreate) navigator.credentials.create = originalCreate;
      if (originalGet) navigator.credentials.get = originalGet;
      if (typeof PublicKeyCredential !== "undefined" && originalIsUvpaa) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable =
          originalIsUvpaa;
      }
    });
  },
});

/**
 * Whether this specific request is one the vault should take over.
 *
 * Conditional mediation (passkey-in-autofill) is deliberately not handled yet:
 * it needs the browser's own autofill surface, so it goes straight through
 * rather than degrading into a blocking prompt.
 */
async function canServe(
  options: CredentialCreationOptions | CredentialRequestOptions,
): Promise<boolean> {
  const creation = ("publicKey" in options ? options.publicKey : undefined) as
    | PublicKeyCredentialCreationOptions
    | undefined;
  const supported = isSupportedRequest({
    mediation: "mediation" in options ? options.mediation : undefined,
    aborted: options.signal?.aborted,
    pubKeyCredParams: creation?.pubKeyCredParams,
    authenticatorAttachment:
      creation?.authenticatorSelection?.authenticatorAttachment,
  });
  if (!supported) return false;
  return isReady();
}

function isReady(): Promise<boolean> {
  return ask("ready", {}, READY_TIMEOUT_MS).then((reply) =>
    Boolean(reply?.ok && reply.ready),
  );
}

function requestCeremony(
  kind: "create" | "get",
  relyingPartyTimeout: number | undefined,
  payload: Record<string, unknown>,
): Promise<BridgeReply | null> {
  const timeout = Math.max(
    relyingPartyTimeout ?? 0,
    MIN_CEREMONY_TIMEOUT_MS,
  );
  return ask(kind, payload, timeout);
}

function ask(
  kind: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<BridgeReply | null> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    let timer = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as
        | { channel?: string; id?: string; reply?: BridgeReply }
        | undefined;
      if (!data || data.channel !== RESPONSE_CHANNEL || data.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data.reply ?? null);
    };
    window.addEventListener("message", onMessage);
    timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    window.postMessage(
      { channel: REQUEST_CHANNEL, id, kind, payload },
      window.location.origin,
    );
  });
}

/**
 * The error WebAuthn defines for a ceremony the user refused.
 *
 * Relying parties already handle NotAllowedError as "the user said no", and
 * the spec deliberately gives the same error for a refusal and a timeout so a
 * page cannot tell which happened.
 */
function cancelled(): DOMException {
  return new DOMException(
    "The operation either timed out or was not allowed.",
    "NotAllowedError",
  );
}

function isCancellation(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotAllowedError";
}

function wantsDiscoverable(
  publicKey: PublicKeyCredentialCreationOptions,
): boolean {
  const selection = publicKey.authenticatorSelection;
  if (!selection) return false;
  if (selection.residentKey) return selection.residentKey !== "discouraged";
  return Boolean(selection.requireResidentKey);
}

function encode(source: BufferSource | undefined): string {
  if (!source) return "";
  const bytes =
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(
          source.buffer,
          source.byteOffset,
          source.byteLength,
        );
  return toBase64Url(bytes);
}

function decode(value: unknown): ArrayBuffer {
  const bytes = fromBase64Url(String(value ?? ""));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/**
 * Shape the return value as a real PublicKeyCredential.
 *
 * Relying parties routinely test the result with instanceof or read it off the
 * prototype, so the object is built on the genuine prototypes rather than as a
 * plain literal.
 */
function buildAttestationCredential(
  reply: BridgeReply,
  publicKey: PublicKeyCredentialCreationOptions,
): PublicKeyCredential {
  const clientDataJSON = decode(reply.clientDataJSON);
  const attestationObject = decode(reply.attestationObject);
  const authenticatorData = decode(reply.authenticatorData);
  const publicKeyBytes = decode(reply.publicKey);
  const algorithm = Number(reply.algorithm ?? COSE_ES256);

  const response = Object.create(
    AuthenticatorAttestationResponse.prototype,
  ) as AuthenticatorAttestationResponse;
  define(response, {
    clientDataJSON,
    attestationObject,
    getAuthenticatorData: () => authenticatorData,
    getPublicKey: () => publicKeyBytes,
    getPublicKeyAlgorithm: () => algorithm,
    getTransports: () => [...TRANSPORTS],
  });

  const credentialId = String(reply.credentialId ?? "");
  const extensions = publicKey.extensions?.credProps
    ? { credProps: { rk: wantsDiscoverable(publicKey) } }
    : {};

  return finishCredential(
    credentialId,
    response,
    extensions,
    attestationCredentialJSON({
      credentialId,
      clientDataJSON: String(reply.clientDataJSON ?? ""),
      attestationObject: String(reply.attestationObject ?? ""),
      authenticatorData: String(reply.authenticatorData ?? ""),
      publicKey: String(reply.publicKey ?? ""),
      publicKeyAlgorithm: algorithm,
      extensions,
    }),
  );
}

function buildAssertionCredential(reply: BridgeReply): PublicKeyCredential {
  const userHandle = String(reply.userHandle ?? "");
  const response = Object.create(
    AuthenticatorAssertionResponse.prototype,
  ) as AuthenticatorAssertionResponse;
  define(response, {
    clientDataJSON: decode(reply.clientDataJSON),
    authenticatorData: decode(reply.authenticatorData),
    signature: decode(reply.signature),
    userHandle: userHandle ? decode(userHandle) : null,
  });

  const credentialId = String(reply.credentialId ?? "");
  return finishCredential(
    credentialId,
    response,
    {},
    assertionCredentialJSON({
      credentialId,
      clientDataJSON: String(reply.clientDataJSON ?? ""),
      authenticatorData: String(reply.authenticatorData ?? ""),
      signature: String(reply.signature ?? ""),
      userHandle,
      extensions: {},
    }),
  );
}

function finishCredential(
  credentialId: string,
  response: AuthenticatorResponse,
  extensions: AuthenticationExtensionsClientOutputs,
  credentialJSON: Record<string, unknown>,
): PublicKeyCredential {
  const credential = Object.create(
    PublicKeyCredential.prototype,
  ) as PublicKeyCredential;
  define(credential, {
    id: credentialId,
    rawId: decode(credentialId),
    type: "public-key",
    authenticatorAttachment: ATTACHMENT,
    response,
    getClientExtensionResults: () => extensions,
    // Must be defined, not inherited. PublicKeyCredential.prototype.toJSON is
    // a native method that needs internal slots this object does not have, so
    // leaving it inherited makes both credential.toJSON() and
    // JSON.stringify(credential) throw - and stringify is how relying parties
    // usually serialise a credential for their server.
    toJSON: () => structuredClone(credentialJSON),
  });
  return credential;
}

function define(target: object, properties: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(target, key, {
      value,
      enumerable: typeof value !== "function",
      configurable: true,
    });
  }
}
