// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Content script for autofill and save-on-submit capture.
 *
 * Runs in the page context (isolated world). It:
 * - detects login forms and their username/password inputs,
 * - shows an inline vaultctl icon in those fields when a stored credential
 *   matches the page (Bitwarden-style), click-to-fill,
 * - optionally autofills on load (configurable),
 * - on submit, asks the background whether to offer save/update and shows a
 *   non-blocking toast that auto-dismisses.
 *
 * All UI is rendered inside a shadow root so page CSS cannot interfere, and
 * no secrets are held here longer than a fill takes.
 */

import {
  classifyField,
  isCardKind,
  isIdentityKind,
  hasCardGroup,
  hasIdentityGroup,
  buildCreditCardData,
  buildIdentityData,
  cardTitle,
  identityTitle,
  type FieldDescriptor,
  type FieldKind,
  type ClassifiedValue,
} from "../utils/form-fields";

interface CredMatch {
  vaultId: string;
  itemId: string;
  name: string;
  username: string;
  vaultName?: string;
  passwordLength?: number;
  hasTotp?: boolean;
}

interface CardFillItem {
  vaultId: string;
  itemId: string;
  name: string;
  vaultName?: string;
  last4?: string;
}
interface IdentityFillItem {
  vaultId: string;
  itemId: string;
  name: string;
  vaultName?: string;
  city?: string;
}

// The data fields a credit_card / identity item stores, used to map a classified
// form field to the stored value to fill. Mirrors the web editor JSON shapes.
const CARD_FIELD_TO_DATA: Partial<Record<FieldKind, string>> = {
  "cc-number": "number",
  "cc-name": "cardholderName",
  "cc-csc": "cvv",
};
const IDENTITY_FIELD_TO_DATA: Partial<Record<FieldKind, string>> = {
  "given-name": "firstName",
  "family-name": "lastName",
  email: "email",
  tel: "phone",
  "street-address": "address",
  "address-level1": "state",
  "address-level2": "city",
  "postal-code": "postalCode",
  country: "country",
};
interface ExtSettings {
  autofill: boolean;
  fieldIcon: boolean;
  savePrompt: boolean;
  toastMs: number;
  suggestPassword: boolean;
}

const BRAND = "#2dd4bf";

const AUTOFILL_ON_LOAD_DELAY_MS = 2000;

// After the extension is reloaded/updated, content scripts injected by the old
// instance keep running in already-open tabs with a dead runtime handle. Reading
// `browser.runtime` or calling `sendMessage` then throws "Extension context
// invalidated" synchronously, which `.catch()` cannot swallow. Guard on the
// runtime id and wrap the call so an orphaned script fails quietly instead.
function bg<T = unknown>(message: Record<string, unknown>): Promise<T> {
  try {
    if (!browser.runtime?.id) return Promise.resolve({} as T);
    return browser.runtime.sendMessage(message).catch(() => ({})) as Promise<T>;
  } catch {
    return Promise.resolve({} as T);
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main(ctx) {
    const observedForms = new WeakSet<HTMLFormElement>();
    let matches: CredMatch[] = [];
    let vaults: { id: string; name: string; type: string }[] = [];
    let settings: ExtSettings = {
      autofill: false,
      fieldIcon: true,
      savePrompt: true,
      toastMs: 8000,
      suggestPassword: true,
    };

    // ── Field detection ──────────────────────────────────────────────────
    // An input the user can actually see and type into. Hidden inputs (honeypot
    // anti-bot fields, off-screen "current-password" fields a SPA keeps mounted,
    // display:none steps) must never be treated as fill targets, or the
    // extension fills a trap field or the wrong form.
    function isVisible(el: HTMLElement): boolean {
      if (el.hidden) return false;
      if (el instanceof HTMLInputElement && el.type === "hidden") return false;
      // offsetParent is null for display:none (and position:fixed, handled by
      // the rect check below); getClientRects is empty for collapsed elements.
      if (el.offsetParent === null && el.getClientRects().length === 0) {
        return false;
      }
      const style = window.getComputedStyle(el);
      if (
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.display === "none" ||
        style.opacity === "0"
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function visiblePasswordCount(form: HTMLFormElement): number {
      return [...form.querySelectorAll('input[type="password"]')].filter((p) =>
        isVisible(p as HTMLInputElement),
      ).length;
    }

    function findLoginForms(): HTMLFormElement[] {
      return [...document.querySelectorAll("form")].filter((f) =>
        f.querySelector('input[type="password"]'),
      ) as HTMLFormElement[];
    }

    // Login forms with at least one visible password field - the only forms we
    // should auto-fill into.
    function findVisibleLoginForms(): HTMLFormElement[] {
      return findLoginForms().filter((f) => visiblePasswordCount(f) > 0);
    }

    // A one-time-code / 2FA field (e.g. Teleport's "Authenticator Code") must
    // never be treated as the username, or we fill it with the username and
    // pin the icon to the wrong field.
    function isOneTimeCodeField(input: HTMLInputElement): boolean {
      const hay = `${input.name} ${input.id} ${input.autocomplete} ${
        input.getAttribute("aria-label") ?? ""
      } ${input.placeholder ?? ""}`.toLowerCase();
      return /otp|one[\s-]?time|2fa|two[\s-]?factor|\bmfa\b|\btoken\b|\bcode\b|authenticat|totp|passcode|verif/.test(
        hay,
      );
    }

    function isUsernameCandidate(input: HTMLInputElement): boolean {
      if (input.type !== "text" && input.type !== "email" && input.type !== "tel") {
        return false;
      }
      return !isOneTimeCodeField(input);
    }

    function extractCredentialInputs(form: HTMLFormElement): {
      usernameInput: HTMLInputElement | null;
      passwordInput: HTMLInputElement | null;
    } {
      // Only consider visible inputs as fill targets: a hidden text input before
      // the password (honeypot, off-screen field) must never become the username
      // target, and a hidden password field must never be filled.
      const inputs = ([...form.querySelectorAll("input")] as HTMLInputElement[]).filter(
        isVisible,
      );
      const passwordInput = inputs.find((i) => i.type === "password") ?? null;
      let usernameInput: HTMLInputElement | null = null;
      // The username is almost always the field immediately before the
      // password - search backwards from it, skipping 2FA/OTP fields.
      if (passwordInput) {
        const pwIndex = inputs.indexOf(passwordInput);
        for (let i = pwIndex - 1; i >= 0; i--) {
          if (isUsernameCandidate(inputs[i]!)) {
            usernameInput = inputs[i]!;
            break;
          }
        }
      }
      // Fallback (e.g. a username-only first step with no password yet): the
      // first username-ish field anywhere in the form.
      if (!usernameInput) usernameInput = inputs.find(isUsernameCandidate) ?? null;
      return { usernameInput, passwordInput };
    }

    // ── Card / identity field classification ─────────────────────────────
    // Build the DOM-free descriptor the pure classifier consumes. The label is
    // resolved from an associated <label for>, a wrapping <label>, or aria-label
    // so a field with only a visible label (no name/id) still classifies.
    function labelText(input: HTMLInputElement): string {
      const aria = input.getAttribute("aria-label");
      if (aria) return aria;
      if (input.id) {
        const forLabel = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (forLabel?.textContent) return forLabel.textContent;
      }
      const wrapping = input.closest("label");
      return wrapping?.textContent ?? "";
    }

    function descriptorFor(input: HTMLInputElement): FieldDescriptor {
      return {
        autocomplete: input.autocomplete || input.getAttribute("autocomplete") || "",
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        label: labelText(input),
        type: input.type,
        value: input.value,
      };
    }

    // Classify every visible input of a form into card/identity field kinds,
    // pairing each with its element and current value.
    function classifyFormFields(form: HTMLFormElement): {
      input: HTMLInputElement;
      kind: FieldKind;
    }[] {
      const inputs = ([...form.querySelectorAll("input, select")] as HTMLInputElement[])
        .filter(isVisible);
      const classified: { input: HTMLInputElement; kind: FieldKind }[] = [];
      for (const input of inputs) {
        const kind = classifyField(descriptorFor(input));
        if (kind) classified.push({ input, kind });
      }
      return classified;
    }

    // Classify the inputs across the whole document (for pages whose card/address
    // fields are not wrapped in a <form>, common on SPA checkouts).
    function classifyDocumentFields(): {
      input: HTMLInputElement;
      kind: FieldKind;
    }[] {
      const inputs = ([...document.querySelectorAll("input, select")] as HTMLInputElement[])
        .filter(isVisible);
      const classified: { input: HTMLInputElement; kind: FieldKind }[] = [];
      for (const input of inputs) {
        const kind = classifyField(descriptorFor(input));
        if (kind) classified.push({ input, kind });
      }
      return classified;
    }

    function setInputValue(input: HTMLInputElement, value: string) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    async function fillWithMatch(form: HTMLFormElement, match: CredMatch) {
      const res = await bg<{ ok?: boolean; username?: string; password?: string }>(
        { type: "fillCredential", vaultId: match.vaultId, itemId: match.itemId },
      );
      if (!res?.ok) return;
      const { usernameInput, passwordInput } = extractCredentialInputs(form);
      if (usernameInput && res.username) setInputValue(usernameInput, res.username);
      if (passwordInput && res.password) setInputValue(passwordInput, res.password);
    }

    // ── Persistent field icon (Google-password-manager style) ─────────────
    // Every username/password field of a matching login form carries a
    // permanently-visible vaultctl emblem (not just on hover/focus), so the
    // user always knows the extension is offering credentials here. Focusing
    // the field - or clicking the emblem - opens the suggestion picker.
    let activeForm: HTMLFormElement | null = null;
    let activeInput: HTMLInputElement | null = null;
    const fieldIcons = new Map<HTMLInputElement, HTMLButtonElement>();

    function positionFieldIcon(input: HTMLInputElement, btn: HTMLButtonElement) {
      const r = input.getBoundingClientRect();
      const visible =
        r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
      btn.style.display = visible ? "flex" : "none";
      if (!visible) return;
      btn.style.left = `${r.right - 28}px`;
      btn.style.top = `${r.top + (r.height - 22) / 2}px`;
    }

    function decorateField(input: HTMLInputElement) {
      if (fieldIcons.has(input)) return;
      const host = document.createElement("div");
      host.className = "vaultctl-field-icon";
      host.style.cssText =
        "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;";
      const root = host.attachShadow({ mode: "closed" });
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", "Fill from vaultctl");
      btn.innerHTML = emblemSVG();
      btn.style.cssText = `all:unset;position:fixed;cursor:pointer;width:22px;height:22px;border-radius:6px;background:${BRAND};display:none;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.3);`;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (document.getElementById("vaultctl-picker-host")) removePicker();
        else openPicker(input);
      });
      root.appendChild(btn);
      document.body.appendChild(host);
      fieldIcons.set(input, btn);
      positionFieldIcon(input, btn);
    }

    function removeIconHost(btn: HTMLButtonElement) {
      const rootNode = btn.getRootNode();
      if (rootNode instanceof ShadowRoot) rootNode.host.remove();
    }

    function clearFieldIcons() {
      for (const btn of fieldIcons.values()) removeIconHost(btn);
      fieldIcons.clear();
    }

    function repositionFieldIcons() {
      for (const [input, btn] of fieldIcons) {
        if (!input.isConnected) {
          removeIconHost(btn);
          fieldIcons.delete(input);
          continue;
        }
        positionFieldIcon(input, btn);
      }
    }

    // Attach the persistent emblem to the username + password inputs of every
    // matching login form. With no matches, there's nothing to offer, so no
    // icon is shown (matching Chrome's own key icon).
    function decorateLoginFields() {
      if (!settings.fieldIcon || matches.length === 0) {
        clearFieldIcons();
        return;
      }
      for (const form of findLoginForms()) {
        const { usernameInput, passwordInput } = extractCredentialInputs(form);
        // Suppress the browser's native autofill / saved-password dropdown on
        // both fields so it doesn't render on top of our picker. We only reach
        // here when there's a stored match (a sign-in), so turning off the
        // password field's autocomplete can't clobber new-password detection
        // (that path runs only when there are no matches).
        if (usernameInput) {
          decorateField(usernameInput);
          usernameInput.autocomplete = "off";
        }
        if (passwordInput) {
          decorateField(passwordInput);
          passwordInput.autocomplete = "off";
        }
      }
      // Split / multi-step logins show the email first with NO password field
      // yet, so findLoginForms misses them. Decorate the email field of those
      // first steps too, so the picker is reachable before the password step.
      for (const form of findUsernameOnlyForms()) {
        const { usernameInput } = extractCredentialInputs(form);
        if (usernameInput) {
          decorateField(usernameInput);
          usernameInput.autocomplete = "off";
        }
      }
      repositionFieldIcons();
    }

    // Forms that carry a username/email field but no password yet, restricted to
    // ones that actually look like a sign-in first step (an email field, or a
    // username/email-hinted field) so we never decorate a search or filter box.
    function findUsernameOnlyForms(): HTMLFormElement[] {
      return [...document.querySelectorAll("form")].filter((form) => {
        if (form.querySelector('input[type="password"]')) return false;
        const inputs = ([...form.querySelectorAll("input")] as HTMLInputElement[])
          .filter(isVisible);
        const candidate = inputs.find(isUsernameCandidate);
        if (!candidate) return false;
        const hint = `${candidate.autocomplete} ${candidate.name} ${candidate.id} ${
          candidate.getAttribute("aria-label") ?? ""
        }`.toLowerCase();
        return candidate.type === "email" || /user|email|login|account/.test(hint);
      }) as HTMLFormElement[];
    }

    function openPicker(input: HTMLInputElement) {
      const form = input.closest("form") as HTMLFormElement | null;
      if (!form || matches.length === 0) return;
      activeForm = form;
      activeInput = input;
      showPicker();
    }

    // Open the appropriate picker on the focused field (or, if focus isn't on a
    // fillable field, the first visible login form's field). Used by the
    // right-click menu and the keyboard command.
    function openFillPickerAtFocus() {
      if (matches.length === 0) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement) {
        if (otpFieldIcons.has(active)) {
          openTotpPicker(active);
          return;
        }
        if (active.closest("form")) {
          openPicker(active);
          return;
        }
      }
      const form = findVisibleLoginForms()[0] ?? findLoginForms()[0];
      if (!form) return;
      const { usernameInput, passwordInput } = extractCredentialInputs(form);
      const target = usernameInput ?? passwordInput;
      if (target) openPicker(target);
    }

    // ── TOTP / 2FA code fill ──────────────────────────────────────────────
    // When a host-matched login carries a TOTP secret, decorate the page's
    // one-time-code field with the emblem; clicking (or focusing) it opens a
    // picker that shows the live code and fills it. The secret never reaches the
    // page - only the short-lived 6-digit code, fetched per click.
    const otpFieldIcons = new Map<HTMLInputElement, HTMLButtonElement>();

    function totpMatches(): CredMatch[] {
      return matches.filter((m) => m.hasTotp);
    }

    // A code-entry input: a one-time-code field that is not itself a password
    // field (those are handled by the credential picker).
    function isOtpInput(input: HTMLInputElement): boolean {
      if (input.type === "password") return false;
      if (!["text", "tel", "number", ""].includes(input.type)) return false;
      return isOneTimeCodeField(input);
    }

    function clearOtpFieldIcons() {
      for (const btn of otpFieldIcons.values()) removeIconHost(btn);
      otpFieldIcons.clear();
    }

    function repositionOtpFieldIcons() {
      for (const [input, btn] of otpFieldIcons) {
        if (!input.isConnected) {
          removeIconHost(btn);
          otpFieldIcons.delete(input);
          continue;
        }
        positionFieldIcon(input, btn);
      }
    }

    function decorateOtpField(input: HTMLInputElement) {
      if (otpFieldIcons.has(input)) return;
      const host = document.createElement("div");
      host.className = "vaultctl-field-icon";
      host.style.cssText =
        "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;";
      const root = host.attachShadow({ mode: "closed" });
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", "Fill 2FA code from vaultctl");
      btn.innerHTML = emblemSVG();
      btn.style.cssText = `all:unset;position:fixed;cursor:pointer;width:22px;height:22px;border-radius:6px;background:${BRAND};display:none;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.3);`;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (document.getElementById("vaultctl-picker-host")) removePicker();
        else openTotpPicker(input);
      });
      root.appendChild(btn);
      document.body.appendChild(host);
      otpFieldIcons.set(input, btn);
      positionFieldIcon(input, btn);
    }

    function decorateOtpFields() {
      if (!settings.fieldIcon || totpMatches().length === 0) {
        clearOtpFieldIcons();
        return;
      }
      for (const node of document.querySelectorAll("input")) {
        const input = node as HTMLInputElement;
        if (isVisible(input) && isOtpInput(input)) decorateOtpField(input);
      }
      repositionOtpFieldIcons();
    }

    function openTotpPicker(anchor: HTMLInputElement) {
      const rows = totpMatches();
      if (rows.length === 0) return;
      removePicker();
      const host = document.createElement("div");
      host.id = "vaultctl-picker-host";
      const root = host.attachShadow({ mode: "closed" });
      const r = anchor.getBoundingClientRect();
      const gap = 4;
      const menu = document.createElement("div");
      menu.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + gap}px;min-width:${Math.max(220, r.width)}px;max-width:min(360px,90vw);background:#101013;color:#fafafa;border:1px solid #26262b;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.4);font:13px system-ui,sans-serif;z-index:2147483647;overflow:hidden;`;
      for (const match of rows) {
        const row = document.createElement("button");
        row.type = "button";
        row.style.cssText =
          "all:unset;display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:8px 12px;cursor:pointer;";
        const glyph = pickerGlyph(
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
        );
        const text = document.createElement("span");
        text.style.cssText =
          "display:flex;flex-direction:column;min-width:0;line-height:1.3;flex:1;";
        const primary = document.createElement("span");
        primary.textContent = match.username || match.name || "2FA code";
        primary.style.cssText =
          "font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        const secondary = document.createElement("span");
        secondary.textContent = "Loading code...";
        secondary.style.cssText =
          "font-size:13px;letter-spacing:2px;color:#2dd4bf;font-family:ui-monospace,monospace;";
        text.append(primary, secondary);
        row.append(glyph, text);
        row.addEventListener("mouseenter", () => (row.style.background = "#1f1f23"));
        row.addEventListener("mouseleave", () => (row.style.background = "transparent"));
        // Fetch the current code to show in the row; the click fills it.
        void bg<{ ok?: boolean; code?: string; secondsRemaining?: number }>({
          type: "generateTotp",
          vaultId: match.vaultId,
          itemId: match.itemId,
        }).then((res) => {
          if (res?.ok && res.code) {
            secondary.textContent = `${res.code}  ·  ${res.secondsRemaining ?? 0}s`;
            row.dataset.code = res.code;
          } else {
            secondary.textContent = "Code unavailable";
          }
        });
        row.addEventListener("click", (e) => {
          if (!e.isTrusted) return;
          const code = row.dataset.code;
          if (code) setInputValue(anchor, code);
          removePicker();
        });
        menu.appendChild(row);
      }
      root.appendChild(menu);
      document.body.appendChild(host);
      setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
    }

    // Open the picker as soon as a decorated field gains focus.
    document.addEventListener(
      "focusin",
      (e) => {
        const target = e.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (otpFieldIcons.has(target)) {
          openTotpPicker(target);
          return;
        }
        if (!fieldIcons.has(target)) return;
        openPicker(target);
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") removePicker();
      },
      true,
    );
    let repositionScheduled = false;
    function scheduleReposition() {
      if (repositionScheduled) return;
      repositionScheduled = true;
      requestAnimationFrame(() => {
        repositionScheduled = false;
        repositionFieldIcons();
        repositionItemFieldIcons();
        repositionOtpFieldIcons();
        repositionSuggestIcons();
      });
    }
    // Scrolling moves the anchor, so close the (fixed-positioned) picker and
    // keep the field icons glued to their inputs.
    window.addEventListener(
      "scroll",
      () => {
        removePicker();
        scheduleReposition();
      },
      true,
    );
    window.addEventListener("resize", () => {
      removePicker();
      scheduleReposition();
    });

    // The current page's declared favicon (same-origin), used to label picker
    // rows. Falls back to the conventional /favicon.ico, then to a globe glyph
    // if neither loads.
    function pageFaviconUrl(): string {
      const link = document.querySelector<HTMLLinkElement>(
        'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
      );
      return link?.href || `${window.location.origin}/favicon.ico`;
    }

    // ── Multi-match picker ───────────────────────────────────────────────
    function showPicker() {
      if (!activeInput || !activeForm) return;
      const form = activeForm;
      const anchor = activeInput;
      removePicker();
      const host = document.createElement("div");
      host.id = "vaultctl-picker-host";
      const root = host.attachShadow({ mode: "closed" });
      const r = anchor.getBoundingClientRect();
      // Place below the field, but flip above when there isn't room, and cap
      // the height so a long list scrolls inside the viewport instead of
      // overflowing off-screen.
      const gap = 4;
      const margin = 8;
      const spaceBelow = window.innerHeight - r.bottom - gap - margin;
      const spaceAbove = r.top - gap - margin;
      const flipUp = spaceBelow < 180 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(320, flipUp ? spaceAbove : spaceBelow));
      const vertical = flipUp
        ? `bottom:${window.innerHeight - r.top + gap}px`
        : `top:${r.bottom + gap}px`;
      const menu = document.createElement("div");
      menu.style.cssText = `position:fixed;left:${r.left}px;${vertical};min-width:${Math.max(240, r.width)}px;max-width:min(360px,90vw);max-height:${maxHeight}px;overflow-y:auto;overscroll-behavior:contain;background:#101013;color:#fafafa;border:1px solid #26262b;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.4);font:13px system-ui,sans-serif;z-index:2147483647;`;
      // All matches are for the current site, so the page's own favicon labels
      // every row (same-origin lookup - no third-party favicon service, which
      // would leak the visited host).
      const faviconUrl = pageFaviconUrl();
      // Only label rows with their vault when the matches span more than one
      // vault, so the user can tell which vault each credential lives in.
      const showVaultName =
        new Set(matches.map((m) => m.vaultId)).size > 1;
      for (const m of matches) {
        const row = document.createElement("button");
        row.type = "button";
        row.style.cssText =
          "all:unset;display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:8px 12px;cursor:pointer;";

        const icon = document.createElement("img");
        icon.src = faviconUrl;
        icon.alt = "";
        icon.width = 20;
        icon.height = 20;
        icon.style.cssText =
          "flex:none;width:20px;height:20px;border-radius:4px;object-fit:contain;background:#1f1f23;";
        // Pages without a usable favicon fall back to a neutral globe glyph.
        icon.addEventListener("error", () => icon.replaceWith(globeIcon()));

        const text = document.createElement("span");
        text.style.cssText =
          "display:flex;flex-direction:column;min-width:0;line-height:1.3;";
        const primary = document.createElement("span");
        primary.textContent = m.username || m.name || "(no username)";
        primary.style.cssText =
          "font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        // Mask the password like Google: a row of dots whose count matches the
        // stored password length (the password itself is never sent here).
        const secondary = document.createElement("span");
        secondary.textContent = m.passwordLength
          ? "•".repeat(m.passwordLength)
          : m.name || "";
        secondary.style.cssText =
          "font-size:12px;letter-spacing:1px;color:#a1a1aa;white-space:nowrap;overflow:hidden;text-overflow:clip;";
        text.append(primary, secondary);
        row.append(icon, text);

        if (showVaultName && m.vaultName) {
          const badge = document.createElement("span");
          badge.textContent = m.vaultName;
          badge.style.cssText =
            "flex:none;margin-left:auto;padding:2px 7px;border-radius:999px;background:#1f1f23;color:#a1a1aa;font-size:11px;max-width:96px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
          row.appendChild(badge);
        }

        row.addEventListener("mouseenter", () => (row.style.background = "#1f1f23"));
        row.addEventListener(
          "mouseleave",
          () => (row.style.background = "transparent"),
        );
        row.addEventListener("click", (e) => {
          // Synthetic page-dispatched clicks (isTrusted=false) must never
          // trigger a fill - only a real user gesture releases a secret.
          if (!e.isTrusted) return;
          void fillWithMatch(form, m);
          removePicker();
        });
        menu.appendChild(row);
      }
      // Footer actions: capture the values currently in this form as a new
      // login, or jump to the web vault. Separated from the credential rows.
      const footer = document.createElement("div");
      footer.style.cssText =
        "border-top:1px solid #26262b;display:flex;flex-direction:column;";
      footer.append(
        actionRow(
          plusGlyph(),
          "Save this site to vaultctl",
          () => {
            captureCurrentForm(form);
            removePicker();
          },
        ),
        actionRow(externalGlyph(), "Open vaultctl", () => {
          void bg({ type: "openWebVault" });
          removePicker();
        }),
      );
      menu.appendChild(footer);
      root.appendChild(menu);
      document.body.appendChild(host);
      setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
    }

    // A non-credential picker row (footer actions). Same look as a match row but
    // a muted leading glyph and a single label.
    function actionRow(
      glyph: HTMLSpanElement,
      label: string,
      onClick: () => void,
    ): HTMLButtonElement {
      const row = document.createElement("button");
      row.type = "button";
      row.style.cssText =
        "all:unset;display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:8px 12px;cursor:pointer;color:#d4d4d8;font-size:12px;";
      const text = document.createElement("span");
      text.textContent = label;
      row.append(glyph, text);
      row.addEventListener("mouseenter", () => (row.style.background = "#1f1f23"));
      row.addEventListener("mouseleave", () => (row.style.background = "transparent"));
      row.addEventListener("click", (e) => {
        if (!e.isTrusted) return;
        onClick();
      });
      return row;
    }

    // Queue a capture from the values currently typed in this form and show the
    // save prompt, so the user can store a brand-new login from the picker.
    function captureCurrentForm(form: HTMLFormElement) {
      const { usernameInput, passwordInput } = extractCredentialInputs(form);
      const password = changedPasswordValue(form) ?? passwordInput?.value ?? "";
      if (!password) {
        void bg({ type: "openWebVault" });
        return;
      }
      void (async () => {
        const queued = await bg<{ ok?: boolean; id?: string; action?: string; username?: string }>(
          {
            type: "loginSubmitted",
            url: window.location.href,
            username: usernameInput?.value ?? "",
            password,
          },
        );
        if (!queued?.ok || !queued.id) return;
        showSavePrompt({
          id: queued.id,
          action: queued.action,
          host: window.location.hostname,
          username: queued.username || usernameInput?.value || "",
        });
      })();
    }
    function onDocClick(e: Event) {
      // Clicks land on the shadow host (event retargeting). Ignore our own
      // picker and field-icon hosts so the icon's own handler can toggle and
      // row clicks can fill before the picker is torn down. Also ignore the
      // anchor field itself: the very click that focuses it (opening the
      // picker) would otherwise be treated as an outside click and close it
      // again immediately.
      const el = e.target as HTMLElement;
      if (el === activeInput) return;
      if (el?.id === "vaultctl-picker-host") return;
      if (el?.classList?.contains("vaultctl-field-icon")) return;
      removePicker();
    }
    function removePicker() {
      document.getElementById("vaultctl-picker-host")?.remove();
      document.removeEventListener("click", onDocClick, true);
    }

    // ── Card / identity fill (strictly user-initiated) ────────────────────
    // Card and identity items have no host binding, so they are NEVER auto-
    // filled on load. We attach a field icon to detected card/identity fields
    // (when the user has stored items of that kind) and only fill when the user
    // explicitly clicks a row in OUR picker. The full number / cvv are pulled
    // per field via fillItemField, never held in the list response.
    let cardFillItems: CardFillItem[] = [];
    let identityFillItems: IdentityFillItem[] = [];
    const itemFieldIcons = new Map<
      HTMLInputElement,
      { btn: HTMLButtonElement; kind: FieldKind }
    >();

    function clearItemFieldIcons() {
      for (const { btn } of itemFieldIcons.values()) removeIconHost(btn);
      itemFieldIcons.clear();
    }

    function repositionItemFieldIcons() {
      for (const [input, entry] of itemFieldIcons) {
        if (!input.isConnected) {
          removeIconHost(entry.btn);
          itemFieldIcons.delete(input);
          continue;
        }
        positionFieldIcon(input, entry.btn);
      }
    }

    function decorateItemField(input: HTMLInputElement, kind: FieldKind) {
      if (itemFieldIcons.has(input)) return;
      const host = document.createElement("div");
      host.className = "vaultctl-field-icon";
      host.style.cssText =
        "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;";
      const root = host.attachShadow({ mode: "closed" });
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", "Fill from vaultctl");
      btn.innerHTML = emblemSVG();
      btn.style.cssText = `all:unset;position:fixed;cursor:pointer;width:22px;height:22px;border-radius:6px;background:${BRAND};display:none;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.3);`;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (document.getElementById("vaultctl-picker-host")) removePicker();
        else openItemPicker(input, kind);
      });
      root.appendChild(btn);
      document.body.appendChild(host);
      itemFieldIcons.set(input, { btn, kind });
      positionFieldIcon(input, btn);
    }

    // Attach the fill emblem to every detected card/identity field, but only for
    // kinds the user actually has stored items for (no card items -> no icon on
    // card fields). Cleared when the icon setting is off or nothing is fillable.
    function decorateItemFields() {
      if (!settings.fieldIcon) {
        clearItemFieldIcons();
        return;
      }
      const hasCards = cardFillItems.length > 0;
      const hasIdentities = identityFillItems.length > 0;
      if (!hasCards && !hasIdentities) {
        clearItemFieldIcons();
        return;
      }
      for (const { input, kind } of classifyDocumentFields()) {
        if (isCardKind(kind) && hasCards) decorateItemField(input, kind);
        else if (isIdentityKind(kind) && hasIdentities) decorateItemField(input, kind);
      }
      repositionItemFieldIcons();
    }

    // ── Suggest-password field emblem ─────────────────────────────────────
    // GPM surfaces "Suggest strong password" as a persistent entry in the field
    // dropdown, not only on focus. Mirror that: decorate new-password fields on
    // signup forms with the emblem so the suggestion is reachable by click too.
    const suggestIcons = new Map<HTMLInputElement, HTMLButtonElement>();

    function clearSuggestIcons() {
      for (const btn of suggestIcons.values()) removeIconHost(btn);
      suggestIcons.clear();
    }

    function repositionSuggestIcons() {
      for (const [input, btn] of suggestIcons) {
        if (!input.isConnected) {
          removeIconHost(btn);
          suggestIcons.delete(input);
          continue;
        }
        positionFieldIcon(input, btn);
      }
    }

    function decorateSuggestField(input: HTMLInputElement) {
      if (suggestIcons.has(input)) return;
      const host = document.createElement("div");
      host.className = "vaultctl-field-icon";
      host.style.cssText =
        "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;";
      const root = host.attachShadow({ mode: "closed" });
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", "Suggest a strong password");
      btn.innerHTML = emblemSVG();
      btn.style.cssText = `all:unset;position:fixed;cursor:pointer;width:22px;height:22px;border-radius:6px;background:${BRAND};display:none;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.3);`;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const form = input.closest("form") as HTMLFormElement | null;
        if (!form) return;
        if (document.getElementById("vaultctl-suggest-host")) removeSuggestion();
        else void showSuggestion(input, form);
      });
      root.appendChild(btn);
      document.body.appendChild(host);
      suggestIcons.set(input, btn);
      positionFieldIcon(input, btn);
    }

    // Decorate visible new-password fields when the suggestion is enabled and
    // there's no stored match (a fresh signup, not a sign-in).
    function decorateSuggestFields() {
      if (!settings.fieldIcon || !settings.suggestPassword || matches.length > 0) {
        clearSuggestIcons();
        return;
      }
      for (const node of document.querySelectorAll('input[type="password"]')) {
        const input = node as HTMLInputElement;
        const form = input.closest("form") as HTMLFormElement | null;
        if (form && isVisible(input) && isNewPasswordField(input, form)) {
          decorateSuggestField(input);
        }
      }
      repositionSuggestIcons();
    }

    function openItemPicker(anchor: HTMLInputElement, kind: FieldKind) {
      const isCard = isCardKind(kind);
      const rows = isCard ? cardFillItems : identityFillItems;
      if (rows.length === 0) return;
      showItemPicker(anchor, isCard);
    }

    function showItemPicker(anchor: HTMLInputElement, isCard: boolean) {
      removePicker();
      const rows = isCard ? cardFillItems : identityFillItems;
      const host = document.createElement("div");
      host.id = "vaultctl-picker-host";
      const root = host.attachShadow({ mode: "closed" });
      const r = anchor.getBoundingClientRect();
      const gap = 4;
      const margin = 8;
      const spaceBelow = window.innerHeight - r.bottom - gap - margin;
      const spaceAbove = r.top - gap - margin;
      const flipUp = spaceBelow < 180 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(320, flipUp ? spaceAbove : spaceBelow));
      const vertical = flipUp
        ? `bottom:${window.innerHeight - r.top + gap}px`
        : `top:${r.bottom + gap}px`;
      const menu = document.createElement("div");
      menu.style.cssText = `position:fixed;left:${r.left}px;${vertical};min-width:${Math.max(240, r.width)}px;max-width:min(360px,90vw);max-height:${maxHeight}px;overflow-y:auto;overscroll-behavior:contain;background:#101013;color:#fafafa;border:1px solid #26262b;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.4);font:13px system-ui,sans-serif;z-index:2147483647;`;
      const showVaultName =
        new Set(rows.map((row) => row.vaultId)).size > 1;
      for (const item of rows) {
        const row = document.createElement("button");
        row.type = "button";
        row.style.cssText =
          "all:unset;display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:8px 12px;cursor:pointer;";
        const glyph = isCard ? cardGlyph() : idGlyph();
        const text = document.createElement("span");
        text.style.cssText =
          "display:flex;flex-direction:column;min-width:0;line-height:1.3;";
        const primary = document.createElement("span");
        primary.textContent = item.name || (isCard ? "Card" : "Identity");
        primary.style.cssText =
          "font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        const secondary = document.createElement("span");
        // Subtitle is masked: card shows only last4, identity shows the city.
        secondary.textContent = isCard
          ? (item as CardFillItem).last4
            ? `•••• ${(item as CardFillItem).last4}`
            : ""
          : (item as IdentityFillItem).city ?? "";
        secondary.style.cssText =
          "font-size:12px;color:#a1a1aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        text.append(primary, secondary);
        row.append(glyph, text);
        if (showVaultName && item.vaultName) {
          const badge = document.createElement("span");
          badge.textContent = item.vaultName;
          badge.style.cssText =
            "flex:none;margin-left:auto;padding:2px 7px;border-radius:999px;background:#1f1f23;color:#a1a1aa;font-size:11px;max-width:96px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
          row.appendChild(badge);
        }
        row.addEventListener("mouseenter", () => (row.style.background = "#1f1f23"));
        row.addEventListener(
          "mouseleave",
          () => (row.style.background = "transparent"),
        );
        row.addEventListener("click", (e) => {
          // Card/identity fills have no host binding, so a forged synthetic
          // click here would hand the page a full card number. Real user
          // gestures only.
          if (!e.isTrusted) return;
          void fillItemEverywhere(item.vaultId, item.itemId, isCard);
          removePicker();
        });
        menu.appendChild(row);
      }
      root.appendChild(menu);
      document.body.appendChild(host);
      setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
    }

    // Fill every detected field of the chosen kind on the page from the picked
    // item. Each field's value is requested individually (full number/cvv only
    // arrive on this explicit, user-initiated request), then written into the
    // matching input.
    async function fillItemEverywhere(
      vaultId: string,
      itemId: string,
      isCard: boolean,
    ) {
      const map = isCard ? CARD_FIELD_TO_DATA : IDENTITY_FIELD_TO_DATA;
      const targets = classifyDocumentFields().filter((field) =>
        isCard ? isCardKind(field.kind) : isIdentityKind(field.kind),
      );
      // De-dup the data fields to fetch (a page may repeat a field), then write
      // each fetched value into every matching input.
      const dataFields = new Set<string>();
      for (const target of targets) {
        const dataField = map[target.kind];
        if (dataField) dataFields.add(dataField);
      }
      const values = new Map<string, string>();
      for (const dataField of dataFields) {
        const res = await bg<{ ok?: boolean; value?: string }>({
          type: "fillItemField",
          vaultId,
          itemId,
          field: dataField,
        });
        if (res?.ok && typeof res.value === "string") {
          values.set(dataField, res.value);
        }
      }
      for (const target of targets) {
        const dataField = map[target.kind];
        if (!dataField) continue;
        const value = values.get(dataField);
        if (value) setInputValue(target.input, value);
      }
    }

    // ── Strong-password suggestion (new-password fields) ──────────────────
    // The "current password" field of a change-password form (the OLD secret).
    // It must never be treated as a new-password field, or the strong-password
    // suggestion pops on it and the submit capture stores the old password.
    function isCurrentPasswordField(input: HTMLInputElement): boolean {
      if (input.type !== "password") return false;
      const ac = (input.autocomplete || "").toLowerCase();
      if (ac === "current-password") return true;
      const hint = `${input.name} ${input.id} ${
        input.getAttribute("aria-label") ?? ""
      } ${input.placeholder ?? ""}`.toLowerCase();
      return /current|\bold\b|existing|previous/.test(hint);
    }

    function isNewPasswordField(
      input: HTMLInputElement,
      form: HTMLFormElement,
    ): boolean {
      if (input.type !== "password") return false;
      if (isCurrentPasswordField(input)) return false;
      const ac = (input.autocomplete || "").toLowerCase();
      if (ac === "new-password") return true;
      const hint = `${input.name} ${input.id} ${
        input.getAttribute("aria-label") ?? ""
      }`.toLowerCase();
      if (/new|confirm|repeat|retype|sign[\s-]?up|register|create/.test(hint)) {
        return true;
      }
      return form.querySelectorAll('input[type="password"]').length >= 2;
    }

    // On a change-password / reset form the FIRST password field is the current
    // (old) secret, so the plain "first password input" the submit handler picks
    // is the wrong one to store. When the form carries a current-password field,
    // return the value of the new-password field instead so we capture the
    // password the user is switching TO. Returns null for ordinary login/signup
    // forms, where the first password field is already correct.
    function changedPasswordValue(form: HTMLFormElement): string | null {
      const passwords = ([...form.querySelectorAll('input[type="password"]')] as HTMLInputElement[])
        .filter(isVisible);
      if (passwords.length < 2) return null;
      if (!passwords.some(isCurrentPasswordField)) return null;
      const next = passwords.find(
        (p) => !isCurrentPasswordField(p) && p.value,
      );
      return next?.value ?? null;
    }

    function removeSuggestion() {
      document.getElementById("vaultctl-suggest-host")?.remove();
    }

    async function showSuggestion(
      input: HTMLInputElement,
      form: HTMLFormElement,
    ) {
      removeSuggestion();
      const res = await bg<{ ok?: boolean; password?: string }>({
        type: "generatePassword",
      });
      if (!res?.ok || !res.password) return;
      if (document.activeElement !== input) return; // focus moved during async hop
      let pw = res.password;

      const host = document.createElement("div");
      host.id = "vaultctl-suggest-host";
      const root = host.attachShadow({ mode: "closed" });
      const r = input.getBoundingClientRect();
      const box = document.createElement("div");
      box.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + 4}px;min-width:${Math.max(240, r.width)}px;max-width:340px;background:#101013;color:#fafafa;border:1px solid #26262b;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);font:13px system-ui,sans-serif;padding:10px 12px;z-index:2147483647;`;
      const title = document.createElement("div");
      title.textContent = "Use a strong password";
      title.style.cssText = "font-weight:600;margin-bottom:6px;";
      const pwEl = document.createElement("code");
      pwEl.textContent = pw;
      pwEl.style.cssText = `display:block;font:12px ui-monospace,monospace;color:${BRAND};word-break:break-all;background:#0c0c0e;border:1px solid #26262b;border-radius:6px;padding:6px 8px;`;
      const actions = document.createElement("div");
      actions.style.cssText =
        "display:flex;gap:8px;justify-content:flex-end;margin-top:8px;";
      const regen = document.createElement("button");
      regen.type = "button";
      regen.textContent = "Regenerate";
      regen.style.cssText =
        "all:unset;cursor:pointer;padding:5px 10px;border-radius:6px;color:#a1a1aa;font-size:12px;";
      const use = document.createElement("button");
      use.type = "button";
      use.textContent = "Use password";
      use.style.cssText = `all:unset;cursor:pointer;padding:5px 12px;border-radius:6px;background:${BRAND};color:#042f2a;font-weight:600;font-size:12px;`;
      regen.addEventListener("mousedown", (e) => e.preventDefault());
      use.addEventListener("mousedown", (e) => e.preventDefault());
      regen.addEventListener("click", async () => {
        const next = await bg<{ ok?: boolean; password?: string }>({
          type: "generatePassword",
        });
        if (next?.ok && next.password) {
          pw = next.password;
          pwEl.textContent = pw;
        }
      });
      use.addEventListener("click", () => {
        // Fill the focused new-password field, plus any OTHER visible
        // new-password field (a confirm box). Never touch hidden password
        // fields or a current-password field, so the secret only lands in the
        // fields the user can actually see and is signing up with.
        setInputValue(input, pw);
        for (const node of form.querySelectorAll('input[type="password"]')) {
          const field = node as HTMLInputElement;
          if (field === input) continue;
          if (isVisible(field) && isNewPasswordField(field, form)) {
            setInputValue(field, pw);
          }
        }
        void bg({ type: "logGeneratedPassword", password: pw });
        removeSuggestion();
      });
      actions.append(regen, use);
      box.append(title, pwEl, actions);
      root.appendChild(box);
      document.body.appendChild(host);
    }

    document.addEventListener(
      "focusin",
      (e) => {
        const target = e.target as HTMLElement;
        if (!settings.suggestPassword) return;
        if (!(target instanceof HTMLInputElement)) return;
        const form = target.closest("form") as HTMLFormElement | null;
        if (!form || !isNewPasswordField(target, form)) return;
        // A stored match means this is a sign-in field, not a fresh signup.
        if (matches.length > 0) return;
        void showSuggestion(target, form);
      },
      true,
    );
    document.addEventListener(
      "focusout",
      () => setTimeout(removeSuggestion, 200),
      true,
    );

    // ── Save / update toast ──────────────────────────────────────────────
    const CROSS_SVG =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

    function showToast(opts: {
      message: string;
      actionLabel: string;
      successMessage: string;
      onAction: (overrides: {
        username?: string;
        vaultId?: string;
        itemTitle?: string;
        itemValues?: Record<string, string>;
      }) => Promise<{ ok?: boolean; error?: string }>;
      onDismiss?: () => void;
      neverLabel?: string;
      onNever?: () => void;
      // When present, the toast shows an editable username and (with >1 vault) a
      // save-target selector, whose values are passed to onAction.
      edit?: {
        username: string;
        vaults: { id: string; name: string; type: string }[];
        defaultVaultId: string;
      };
      // When present, the toast shows an editable title and a scrollable list of
      // the captured card / address fields for review before saving.
      itemEdit?: {
        title: string;
        fields: { key: string; label: string; value: string }[];
      };
    }) {
      document.getElementById("vaultctl-toast-host")?.remove();
      const host = document.createElement("div");
      host.id = "vaultctl-toast-host";
      const root = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent =
        "@keyframes vc-pop{0%{transform:scale(.5)}60%{transform:scale(1.15)}100%{transform:scale(1)}}" +
        // The emblem drops and latches like a lock clicking shut.
        "@keyframes vc-lock{0%{transform:translateY(-7px) scale(1.25);opacity:.3}55%{transform:translateY(2px) scale(.9)}100%{transform:translateY(0) scale(1);opacity:1}}" +
        "@keyframes vc-glow{0%{transform:scale(.5);opacity:.7}100%{transform:scale(2.2);opacity:0}}";
      root.appendChild(style);
      const card = document.createElement("div");
      card.style.cssText =
        "position:fixed;right:16px;top:16px;width:300px;background:#101013;color:#fafafa;border:1px solid #26262b;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px system-ui,sans-serif;padding:12px 14px;z-index:2147483647;opacity:0;transform:translateX(120%) scale(.98);transition:opacity .35s cubic-bezier(.16,1,.3,1),transform .45s cubic-bezier(.16,1,.3,1),border-color .3s ease;";
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;";
      const icon = document.createElement("span");
      icon.innerHTML = emblemSVG(BRAND);
      icon.style.cssText = `position:relative;flex:none;width:24px;height:24px;border-radius:7px;background:${BRAND}1a;display:flex;align-items:center;justify-content:center;transition:background .3s ease;`;
      const msg = document.createElement("div");
      msg.style.cssText =
        "flex:1;line-height:1.35;transition:opacity .2s ease;";
      msg.textContent = opts.message;
      row.append(icon, msg);
      const actions = document.createElement("div");
      actions.style.cssText =
        "display:flex;gap:8px;justify-content:flex-end;margin-top:10px;max-height:40px;overflow:hidden;transition:max-height .3s ease,opacity .2s ease,margin-top .3s ease;";
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.textContent = "Not now";
      dismiss.style.cssText =
        "all:unset;cursor:pointer;padding:5px 10px;border-radius:6px;color:#a1a1aa;font-size:12px;";
      const action = document.createElement("button");
      action.type = "button";
      action.textContent = opts.actionLabel;
      action.style.cssText = `all:unset;cursor:pointer;padding:5px 12px;border-radius:6px;background:${BRAND};color:#042f2a;font-weight:600;font-size:12px;`;
      // Optional editable username + save-target selector (login saves only).
      let usernameField: HTMLInputElement | null = null;
      let vaultSelect: HTMLSelectElement | null = null;
      if (opts.edit) {
        const editWrap = document.createElement("div");
        editWrap.style.cssText = "margin-top:10px;display:flex;flex-direction:column;gap:6px;";
        usernameField = document.createElement("input");
        usernameField.type = "text";
        usernameField.value = opts.edit.username;
        usernameField.placeholder = "username";
        usernameField.style.cssText =
          "all:unset;box-sizing:border-box;width:100%;background:#0c0c0e;border:1px solid #26262b;border-radius:6px;padding:6px 8px;color:#fafafa;font-size:12px;";
        editWrap.append(usernameField);
        if (opts.edit.vaults.length > 1) {
          vaultSelect = document.createElement("select");
          vaultSelect.style.cssText =
            "all:unset;box-sizing:border-box;width:100%;background:#0c0c0e;border:1px solid #26262b;border-radius:6px;padding:6px 8px;color:#fafafa;font-size:12px;cursor:pointer;";
          for (const vault of opts.edit.vaults) {
            const option = document.createElement("option");
            option.value = vault.id;
            option.textContent =
              vault.type === "shared" ? `${vault.name} (shared)` : vault.name;
            if (vault.id === opts.edit.defaultVaultId) option.selected = true;
            vaultSelect.append(option);
          }
          editWrap.append(vaultSelect);
        }
        card.append(row, editWrap);
      } else {
        card.append(row);
      }
      // Optional card / address field review: an editable title plus one input
      // per captured field, scrollable so a long address fits.
      let itemTitleField: HTMLInputElement | null = null;
      const itemFieldInputs = new Map<string, HTMLInputElement>();
      if (opts.itemEdit) {
        const wrap = document.createElement("div");
        wrap.style.cssText =
          "margin-top:10px;display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;overscroll-behavior:contain;";
        itemTitleField = document.createElement("input");
        itemTitleField.type = "text";
        itemTitleField.value = opts.itemEdit.title;
        itemTitleField.placeholder = "name";
        itemTitleField.style.cssText =
          "all:unset;box-sizing:border-box;width:100%;background:#0c0c0e;border:1px solid #26262b;border-radius:6px;padding:6px 8px;color:#fafafa;font-size:12px;font-weight:600;";
        wrap.append(itemTitleField);
        for (const field of opts.itemEdit.fields) {
          const label = document.createElement("label");
          label.style.cssText =
            "display:flex;flex-direction:column;gap:2px;font-size:10px;color:#a1a1aa;";
          const labelText = document.createElement("span");
          labelText.textContent = field.label;
          const input = document.createElement("input");
          input.type = "text";
          input.value = field.value;
          input.style.cssText =
            "all:unset;box-sizing:border-box;width:100%;background:#0c0c0e;border:1px solid #26262b;border-radius:6px;padding:6px 8px;color:#fafafa;font-size:12px;";
          label.append(labelText, input);
          wrap.append(label);
          itemFieldInputs.set(field.key, input);
        }
        card.append(wrap);
      }
      actions.append(dismiss, action);
      card.append(actions);
      const editWrapHide = () => {
        if (usernameField) usernameField.parentElement!.style.display = "none";
        if (itemTitleField) itemTitleField.parentElement!.style.display = "none";
      };
      // Optional tertiary opt-out: stop offering to save on this site at all.
      let never: HTMLButtonElement | null = null;
      if (opts.onNever && opts.neverLabel) {
        never = document.createElement("button");
        never.type = "button";
        never.textContent = opts.neverLabel;
        never.style.cssText =
          "all:unset;cursor:pointer;display:block;margin-top:6px;color:#71717a;font-size:11px;";
        card.append(never);
      }
      root.appendChild(card);
      document.body.appendChild(host);
      requestAnimationFrame(() => {
        card.style.opacity = "1";
        card.style.transform = "translateX(0) scale(1)";
      });

      let done = false;
      const close = () => {
        if (done) return;
        done = true;
        card.style.opacity = "0";
        card.style.transform = "translateX(120%) scale(.98)";
        setTimeout(() => host.remove(), 300);
      };

      const collapseActions = () => {
        actions.style.maxHeight = "0";
        actions.style.opacity = "0";
        actions.style.marginTop = "0";
        if (never) never.style.display = "none";
        editWrapHide();
      };

      // Smoothly morph the same toast into a success / error state instead of
      // vanishing, so the outcome of the save is unmistakable.
      const lockSuccess = () => {
        card.style.borderColor = `${BRAND}66`;
        icon.style.background = `${BRAND}29`;
        icon.innerHTML = "";
        const glow = document.createElement("span");
        glow.style.cssText = `position:absolute;inset:0;border-radius:50%;background:${BRAND};animation:vc-glow .6s ease-out forwards;`;
        const mark = document.createElement("span");
        mark.style.cssText =
          "position:relative;display:flex;animation:vc-lock .55s cubic-bezier(.16,1,.3,1) forwards;";
        mark.innerHTML = emblemSVG(BRAND);
        icon.append(glow, mark);
      };
      const showError = (text: string) => {
        card.style.borderColor = "#ef444466";
        icon.style.background = "#ef44441f";
        icon.style.animation = "vc-pop .42s cubic-bezier(.16,1,.3,1) forwards";
        icon.innerHTML = CROSS_SVG;
        swapMessage(text);
      };
      const swapMessage = (text: string) => {
        msg.style.opacity = "0";
        setTimeout(() => {
          msg.textContent = text;
          msg.style.opacity = "1";
        }, 180);
      };

      let settled = false;
      const submit = async () => {
        if (settled) return;
        settled = true;
        action.textContent = "Saving...";
        dismiss.style.pointerEvents = action.style.pointerEvents = "none";
        action.style.opacity = "0.7";
        const overrides = {
          username: usernameField ? usernameField.value : undefined,
          vaultId: vaultSelect ? vaultSelect.value : undefined,
          itemTitle: itemTitleField ? itemTitleField.value : undefined,
          itemValues: itemFieldInputs.size
            ? Object.fromEntries(
                [...itemFieldInputs].map(([key, input]) => [key, input.value]),
              )
            : undefined,
        };
        let res: { ok?: boolean; error?: string };
        try {
          res = await opts.onAction(overrides);
        } catch {
          res = { ok: false, error: "connection problem" };
        }
        if (res?.ok) {
          lockSuccess();
          swapMessage(opts.successMessage);
          collapseActions();
          setTimeout(close, 1900);
        } else {
          showError(`Couldn't save - ${res?.error || "connection problem"}`);
          // Keep the toast around so the user can read the error and dismiss.
          dismiss.style.pointerEvents = "auto";
          action.remove();
          dismiss.textContent = "Dismiss";
          dismiss.style.opacity = "1";
          setTimeout(close, 5000);
        }
      };

      dismiss.addEventListener("click", () => {
        opts.onDismiss?.();
        close();
      });
      never?.addEventListener("click", () => {
        opts.onNever?.();
        close();
      });
      action.addEventListener("click", () => void submit());
      // Auto-timeout closes the toast WITHOUT resolving the capture, so a submit
      // that redirected mid-prompt can still re-open it on the page the user
      // lands on. Only an explicit dismiss or a successful save resolves it.
      setTimeout(close, Math.max(2000, settings.toastMs));
    }

    // showSavePrompt renders the save/update toast for a queued capture, wired
    // so the action saves that exact capture (by id, using the password the
    // background already holds) and an explicit dismiss marks it read so it
    // stops re-prompting. Used both on the original submit and when re-opened
    // on a redirected page.
    function showSavePrompt(prompt: {
      id: string;
      kind?: string;
      action?: string;
      host: string;
      username: string;
      title?: string;
    }) {
      const neverSave = () => {
        void bg({ type: "markCaptureRead", id: prompt.id });
        void bg({ type: "neverSaveHost" });
      };
      if (prompt.kind === "credit_card" || prompt.kind === "identity") {
        const isCard = prompt.kind === "credit_card";
        const what = prompt.title || (isCard ? "this card" : "this address");
        showToast({
          message: isCard ? "Save card?" : "Save address?",
          actionLabel: "Save",
          successMessage: isCard
            ? `Locked ${what} in your vault`
            : `Saved ${what} to your vault`,
          onAction: () =>
            bg<{ ok?: boolean; error?: string }>({
              type: "saveCapturedLogin",
              id: prompt.id,
            }),
          onDismiss: () => void bg({ type: "markCaptureRead", id: prompt.id }),
          neverLabel: "Never for this site",
          onNever: neverSave,
        });
        return;
      }
      const isUpdate = prompt.action === "update";
      const who = prompt.username || prompt.host;
      // A new save lets the user fix the username and pick the target vault; an
      // update goes to the existing item's vault, so only the message is shown.
      const defaultVaultId =
        vaults.find((v) => v.type === "personal")?.id ?? vaults[0]?.id ?? "";
      showToast({
        message: isUpdate
          ? `Update the saved password for ${who}?`
          : `Save this login for ${prompt.host} to vaultctl?`,
        actionLabel: isUpdate ? "Update" : "Save",
        successMessage: isUpdate
          ? `Updated and locked ${who}`
          : `Locked ${prompt.host} in your vault`,
        edit: isUpdate
          ? undefined
          : { username: prompt.username, vaults, defaultVaultId },
        onAction: (overrides) =>
          bg<{ ok?: boolean; error?: string }>({
            type: "saveCapturedLogin",
            id: prompt.id,
            ...(overrides.username !== undefined
              ? { username: overrides.username }
              : {}),
            ...(overrides.vaultId ? { vaultId: overrides.vaultId } : {}),
          }),
        onDismiss: () => void bg({ type: "markCaptureRead", id: prompt.id }),
        neverLabel: "Never for this site",
        onNever: neverSave,
      });
    }

    // ── Submit capture → save/update decision ─────────────────────────────
    // Remember a username/email value so a later password-only step can
    // reuse it (multi-step / split login forms).
    function rememberUsername(value: string) {
      if (value) {
        void bg({
          type: "rememberUsername",
          host: window.location.hostname,
          username: value,
        });
      }
    }

    // Detect a card group and/or an identity group in a submitted form and
    // queue a capture for each. A checkout form can yield BOTH, so they are
    // handled independently. Capture goes through the same background queue ->
    // encrypt -> POST path as logins; the save toast then labels itself.
    function captureCardIdentity(form: HTMLFormElement) {
      const classified = classifyFormFields(form);
      if (classified.length === 0) return;
      const origin = window.location.href;

      const cardFields: ClassifiedValue[] = classified
        .filter((c) => isCardKind(c.kind))
        .map((c) => ({ kind: c.kind, value: c.input.value }));
      const identityFields: ClassifiedValue[] = classified
        .filter((c) => isIdentityKind(c.kind))
        .map((c) => ({ kind: c.kind, value: c.input.value }));

      if (hasCardGroup(cardFields)) {
        const cardData = buildCreditCardData(cardFields);
        queueItemCapture("credit_card", origin, cardData, cardTitle(cardData));
      }
      if (hasIdentityGroup(identityFields)) {
        const identityData = buildIdentityData(identityFields);
        queueItemCapture(
          "identity",
          origin,
          identityData,
          identityTitle(identityData),
        );
      }
    }

    function queueItemCapture(
      kind: "credit_card" | "identity",
      url: string,
      data: unknown,
      title: string,
    ) {
      void (async () => {
        const queued = await bg<{ ok?: boolean; id?: string }>({
          type: "captureItemSubmitted",
          kind,
          url,
          data,
          title,
        });
        if (!settings.savePrompt) return;
        if (!queued?.ok || !queued.id) return;
        // The content script still holds the captured payload here, so show an
        // editable review toast (title + fields) before saving.
        showItemSavePrompt(queued.id, kind, data as Record<string, unknown>, title);
      })();
    }

    // Human labels for the card / identity fields worth reviewing in the toast.
    // Order matters; only non-empty string fields are shown.
    const ITEM_FIELD_LABELS: Record<
      "credit_card" | "identity",
      { key: string; label: string }[]
    > = {
      credit_card: [
        { key: "cardholderName", label: "Cardholder" },
        { key: "number", label: "Number" },
        { key: "expiry", label: "Expiry" },
        { key: "cvv", label: "CVV" },
      ],
      identity: [
        { key: "firstName", label: "First name" },
        { key: "lastName", label: "Last name" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
        { key: "address", label: "Address" },
        { key: "city", label: "City" },
        { key: "state", label: "State" },
        { key: "postalCode", label: "Postal code" },
        { key: "country", label: "Country" },
      ],
    };

    // Editable review toast for a freshly captured card / address: the user can
    // fix the title and any field, and the edited payload is saved.
    function showItemSavePrompt(
      id: string,
      kind: "credit_card" | "identity",
      data: Record<string, unknown>,
      title: string,
    ) {
      const isCard = kind === "credit_card";
      const fields = ITEM_FIELD_LABELS[kind]
        .map((f) => ({ key: f.key, label: f.label, value: String(data[f.key] ?? "") }))
        .filter((f) => f.value);
      showToast({
        message: isCard ? "Review and save card?" : "Review and save address?",
        actionLabel: "Save",
        successMessage: isCard
          ? "Locked this card in your vault"
          : "Saved this address to your vault",
        itemEdit: { title, fields },
        onAction: (overrides) =>
          bg<{ ok?: boolean; error?: string }>({
            type: "saveCapturedLogin",
            id,
            ...(overrides.itemTitle ? { title: overrides.itemTitle } : {}),
            // Merge edits back over the original payload so untouched fields
            // (and non-string fields like customFields) are preserved.
            data: { ...data, ...(overrides.itemValues ?? {}) },
          }),
        onDismiss: () => void bg({ type: "markCaptureRead", id }),
        neverLabel: "Never for this site",
        onNever: () => {
          void bg({ type: "markCaptureRead", id });
          void bg({ type: "neverSaveHost" });
        },
      });
    }

    function handleSubmit(event: Event) {
      const form = event.target as HTMLFormElement | null;
      if (!form || form.tagName !== "FORM") return;
      captureCardIdentity(form);
      const { usernameInput, passwordInput } = extractCredentialInputs(form);
      const origin = window.location.href;
      const host = window.location.hostname;

      // Step one of a multi-step form: an email/username with no password yet.
      // Stash it so the password step can pick it up.
      if (!passwordInput || !passwordInput.value) {
        rememberUsername(usernameInput?.value ?? "");
        return;
      }
      // On a change/reset form the first password field is the OLD secret;
      // store the new-password value instead so we offer to UPDATE the saved
      // credential with the password the user just set.
      const password = changedPasswordValue(form) ?? passwordInput.value;
      const immediateUsername = usernameInput?.value ?? "";

      // Queue the durable capture FIRST and synchronously, before any await.
      // A submit usually navigates the page (redirect to a dashboard), which
      // tears down this content script; the sendMessage is dispatched here so
      // the background receives and persists the capture even if the page is
      // gone before the response arrives. The background recovers a remembered
      // email when this step carried none, de-dupes already-saved credentials,
      // and returns the save decision so the toast can label itself.
      void (async () => {
        const queued = await bg<{
          ok?: boolean;
          id?: string;
          skipped?: boolean;
          action?: string;
          username?: string;
        }>({
          type: "loginSubmitted",
          url: origin,
          username: immediateUsername,
          password,
        });

        if (!settings.savePrompt) return;
        if (!queued?.ok || queued.skipped || !queued.id) return;
        // If the page already navigated, this toast won't render here - the
        // capture is queued and getPendingPrompt re-opens it on the next load.
        showSavePrompt({
          id: queued.id,
          action: queued.action,
          host,
          username: queued.username || immediateUsername,
        });
      })();
    }

    // Forms worth observing for submit: login forms (password present) and forms
    // that carry a card or identity field, so a checkout / shipping form without
    // a password is still captured. handleSubmit runs both the login and the
    // card/identity capture paths, de-duped per form via observedForms.
    function findCaptureForms(): HTMLFormElement[] {
      const seen = new Set<HTMLFormElement>(findLoginForms());
      for (const node of document.querySelectorAll("input, select")) {
        const input = node as HTMLInputElement;
        if (!isVisible(input)) continue;
        const form = input.closest("form");
        if (!form || seen.has(form)) continue;
        if (classifyField(descriptorFor(input))) seen.add(form);
      }
      return [...seen];
    }

    function attachSubmitListeners() {
      for (const form of findCaptureForms()) {
        if (observedForms.has(form)) continue;
        observedForms.add(form);
        form.addEventListener("submit", handleSubmit, { capture: true });
      }
    }

    // Remember an email/username as soon as the user leaves the field, so a
    // later password-only step (incl. SPA step changes with no form submit)
    // can still be saved with its email.
    document.addEventListener(
      "focusout",
      (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement) || t.type === "password") return;
        const isUser =
          t.type === "email" ||
          (t.autocomplete || "").includes("username") ||
          /user|email/i.test(`${t.name} ${t.id}`);
        if (isUser && t.value) rememberUsername(t.value);
      },
      true,
    );

    // Remember the email/username on ANY form submit, captured at document
    // level. A multi-step login's first step is an email-only form (no password
    // field), so findLoginForms ignores it and focusout alone is unreliable -
    // pressing Enter submits without ever blurring the field. This catches that
    // step's email (Enter or click) right before the SPA swaps in the password
    // step, so the password step can be saved/matched with its real email.
    document.addEventListener(
      "submit",
      (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        const { usernameInput } = extractCredentialInputs(form);
        if (usernameInput?.value) rememberUsername(usernameInput.value);
      },
      true,
    );

    // ── Boot: fetch matches + settings, wire forms, optional autofill ──────
    async function refreshMatches() {
      const res = await bg<{
        ok?: boolean;
        settings?: ExtSettings;
        matches?: CredMatch[];
        vaults?: { id: string; name: string; type: string }[];
      }>({ type: "matchCredentials", origin: window.location.href });
      if (res?.settings) settings = res.settings;
      matches = res?.matches ?? [];
      vaults = res?.vaults ?? [];
      decorateLoginFields();
      decorateOtpFields();
      decorateSuggestFields();
      // Only auto-fill on load when the page is unambiguous: exactly one visible
      // login form and exactly one matching credential. Anything else (multiple
      // forms, multiple matches) waits for the user to pick from the icon/picker,
      // so we never silently fill the wrong form or guess between credentials.
      // The attempt is delayed because at document_idle SPA login pages often
      // haven't rendered their form yet (or it is mid fade-in and fails the
      // visibility check), so an immediate attempt finds zero forms and the
      // fill silently never happens.
      if (settings.autofill && matches.length === 1) {
        ctx.setTimeout(() => {
          const forms = findVisibleLoginForms();
          if (forms.length !== 1) return;
          const { usernameInput, passwordInput } = extractCredentialInputs(
            forms[0]!,
          );
          // The user may have started typing during the delay - a focused or
          // non-empty field means the form is theirs now, and a silent
          // overwrite could swap in the wrong credential mid-keystroke.
          if (!isUntouched(usernameInput) || !isUntouched(passwordInput)) {
            return;
          }
          void fillWithMatch(forms[0]!, matches[0]!);
        }, AUTOFILL_ON_LOAD_DELAY_MS);
      }
    }

    function isUntouched(input: HTMLInputElement | null): boolean {
      return !input || (!input.value && input !== document.activeElement);
    }

    // Load the user's cards/identities (masked) so the fill emblem can appear on
    // detected card/address fields. NEVER triggers a fill - cards/identities are
    // filled only when the user explicitly clicks a picker row.
    async function refreshFillItems() {
      const res = await bg<{
        ok?: boolean;
        cards?: CardFillItem[];
        identities?: IdentityFillItem[];
      }>({ type: "listFillItems" });
      cardFillItems = res?.cards ?? [];
      identityFillItems = res?.identities ?? [];
      decorateItemFields();
    }

    // Popup-initiated explicit fill (existing behaviour).
    browser.runtime.onMessage.addListener(
      (message: { type: string; username?: string; password?: string }) => {
        // Unlocking after this page loaded: the boot-time matchCredentials ran
        // against a locked vault and got no matches, so re-fetch now or the tab
        // shows no icons/autofill until a manual reload.
        if (message.type === "vaultUnlocked") {
          void refreshMatches();
          void refreshFillItems();
          return;
        }
        // Right-click menu / keyboard command: open the fill picker on the
        // focused field, falling back to the page's first login form field.
        if (message.type === "openFillPicker") {
          openFillPickerAtFocus();
          return;
        }
        if (message.type === "fill") {
          const forms = findLoginForms();
          if (forms[0] && message.username && message.password) {
            const { usernameInput, passwordInput } = extractCredentialInputs(
              forms[0],
            );
            if (usernameInput) setInputValue(usernameInput, message.username);
            if (passwordInput) setInputValue(passwordInput, message.password);
          }
        }
      },
    );

    // After a submit redirects to a new page, re-open the save toast here so the
    // user still gets a chance to save the credential they just entered.
    async function maybeReopenSavePrompt() {
      if (!settings.savePrompt) return;
      // Don't stack a second toast over one already on screen (e.g. an SPA
      // navigation re-check while the original prompt is still showing).
      if (document.getElementById("vaultctl-toast-host")) return;
      const res = await bg<{
        ok?: boolean;
        prompt?: { id: string; action?: string; host: string; username: string };
      }>({ type: "getPendingPrompt", host: window.location.hostname });
      if (res?.prompt) showSavePrompt(res.prompt);
    }

    attachSubmitListeners();
    void refreshMatches().then(() => void maybeReopenSavePrompt());
    void refreshFillItems();

    // A login submitted in a single-page app navigates by history (no full
    // reload), so the boot-time re-open check never re-runs and the save toast
    // shown on the login route can be lost when the app swaps in the next view.
    // Content scripts run in an isolated world and can't intercept the page's
    // own history calls, so detect the URL change off the DOM mutations the
    // route change already produces and re-check for a pending save prompt.
    let lastHref = window.location.href;
    const mutationObserver = new MutationObserver(() => {
      attachSubmitListeners();
      decorateLoginFields();
      decorateItemFields();
      decorateOtpFields();
      decorateSuggestFields();
      if (window.location.href !== lastHref) {
        lastHref = window.location.href;
        void maybeReopenSavePrompt();
      }
    });
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    ctx.onInvalidated(() => {
      mutationObserver.disconnect();
      clearFieldIcons();
      clearItemFieldIcons();
      clearOtpFieldIcons();
      clearSuggestIcons();
      removePicker();
      removeSuggestion();
    });

    if (findLoginForms().length > 0) {
      void bg({ type: "loginFormDetected", url: window.location.href });
    }
  },
});

// The actual VaultCTL emblem (shield + keyhole + V), vectorized from the
// brand mark, so the inline icon shows the real logo rather than a generic
// shield. viewBox 0 0 1024 1024; fill carries the V/keyhole as negative space.
const EMBLEM_PATH =
  "M483 200c-16.8 5.4-49.2 15.8-72 23-65.1 20.6-119.3 38-121.7 39-2.3 1-2.3 1-2.3 26l0 25 22 0 22 0 0-11.5c0-6.3 0.2-11.5 0.5-11.5 0.3 0 24.9-7.9 54.7-17.6 29.9-9.7 70.9-22.9 91.2-29.5l36.9-11.9 24.1 7.6c13.3 4.2 36 11.4 50.6 16.1 14.6 4.7 34.4 11 44 14.1 9.6 3.1 27.9 9 40.5 13.2l23 7.6 0.3 11.7 0.3 11.7 21.9 0 22 0 0-25.3 0-25.3-49.7-16.1c-27.4-8.9-61.5-19.8-75.8-24.3-14.3-4.5-42.8-13.6-63.3-20.1-20.5-6.6-37.6-11.9-38-11.9-0.4 0.1-14.4 4.5-31.2 10z M499.5 262.5c-7.1 2.4-41.7 13.7-76.7 25.1l-63.8 20.8 0 15.3 0 15.3-23.7 0c-45.4 0-85.8 0.3-86.5 0.7-0.4 0.2 4.7 9.2 11.2 20.1l12 19.7 0 63.5c0 63.1 0.7 83.4 3.6 102.5 6.3 42.2 22.9 84.7 49.3 126.1 35.4 55.3 95.9 113.6 170.5 164.3 12.5 8.4 15.6 10.1 18.8 10.1 3.2 0 6.3-1.7 20-11.2 56-38.4 103-79.8 137.2-120.6 47.3-56.6 76.2-120.1 82.6-181.4 0.5-5.4 1-41 1-81l0.1-71.3 11.9-19.5c11.1-18.1 13.2-22.2 11.3-21.9-0.5 0.1-25.2 0.1-55 0l-54.3-0.1 0-15.4 0-15.3-9.2-3c-110.6-36.2-144.9-47.3-146.2-47.2-0.6 0-6.9 2-14.1 4.4z m-118.5 135.2c6.3 12.5 19.5 37.9 29.2 56.6l17.8 34-2.7 8.1c-2.4 7.4-2.7 9.6-2.7 24.1-0.1 13.8 0.2 17.1 2.2 23.8 3.7 12.9 10.7 25.6 19.7 35.7l4.2 4.8-1.2 7.3c-0.7 4.1-3.7 24.1-6.6 44.6-3 20.5-5.7 36.9-6 36.5-0.8-0.9-19.3-35.8-49.4-93.2-12.5-23.9-29.8-57-38.5-73.5-8.6-16.5-19.4-37.2-24-46-7.2-13.9-20.9-39.9-39.7-75.3l-5.4-10.2 45.8 0 45.8 0 11.5 22.7z m368-22.2c0 0.3-11.2 21.8-24.9 47.8-33.2 63.2-67.6 129-94.3 180.7-12.1 23.4-23 44.3-24.3 46.5-1.2 2.2-4.6 8.7-7.6 14.5l-5.3 10.5-1.8-12.5c-0.9-6.9-3.9-27.3-6.6-45.5l-4.9-33 5.6-6.1c10-10.9 17.5-26.6 20.2-42.1 1.9-10.8 0.7-30.2-2.5-40l-2.7-8.2 4.2-8.2c6.3-12.6 48.7-93.7 52.1-99.7l2.9-5.2 45 0c24.7 0 44.9 0.2 44.9 0.5z m-214.8 84.7c18.7 6.1 33.5 21.3 39.5 40.5 2.3 7.5 2.5 9.5 2.1 20.1-0.4 9.9-0.9 12.8-3.3 18.7-3.8 9.5-9.1 17-16.9 24.2l-6.5 5.9 4.9 34c6.8 47 11.5 79.5 14 95.6l2.1 13.7-27.4 48.8c-15.1 26.8-27.9 48.9-28.4 49-1 0.4-0.8 0.8-31.9-54.8l-24.4-43.6 3.5-23.9c2-13.1 6.7-44.3 10.5-69.2 3.9-24.9 7-46.5 7-48-0.1-2-1.2-3.6-4.6-6.1-9.1-6.9-17.1-19.7-20.5-32.9-3.5-13.7-1.8-26.8 5.2-41.1 7.9-16 24.1-28.6 41.9-32.6 9.4-2.1 23.5-1.4 33.2 1.7z";

function emblemSVG(fill = "#ffffff"): string {
  return `<svg width="16" height="16" viewBox="0 0 1024 1024" fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="${EMBLEM_PATH}"/></svg>`;
}

function pickerGlyph(svg: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.style.cssText =
    "flex:none;width:20px;height:20px;border-radius:4px;display:flex;align-items:center;justify-content:center;background:#1f1f23;";
  span.innerHTML = svg;
  return span;
}

function plusGlyph(): HTMLSpanElement {
  return pickerGlyph(
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  );
}

function externalGlyph(): HTMLSpanElement {
  return pickerGlyph(
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  );
}

function cardGlyph(): HTMLSpanElement {
  return pickerGlyph(
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  );
}

function idGlyph(): HTMLSpanElement {
  return pickerGlyph(
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>',
  );
}

// Neutral globe glyph shown when a page has no loadable favicon, so picker
// rows always have a consistent leading icon.
function globeIcon(): HTMLSpanElement {
  const span = document.createElement("span");
  span.style.cssText =
    "flex:none;width:20px;height:20px;border-radius:4px;display:flex;align-items:center;justify-content:center;background:#1f1f23;";
  span.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>';
  return span;
}
