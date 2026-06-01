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

interface CredMatch {
  vaultId: string;
  itemId: string;
  name: string;
  username: string;
}
interface ExtSettings {
  autofill: boolean;
  fieldIcon: boolean;
  savePrompt: boolean;
  toastMs: number;
  suggestPassword: boolean;
}

const BRAND = "#2dd4bf";

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
    let settings: ExtSettings = {
      autofill: false,
      fieldIcon: true,
      savePrompt: true,
      toastMs: 8000,
      suggestPassword: true,
    };

    // ── Field detection ──────────────────────────────────────────────────
    function findLoginForms(): HTMLFormElement[] {
      return [...document.querySelectorAll("form")].filter((f) =>
        f.querySelector('input[type="password"]'),
      ) as HTMLFormElement[];
    }

    function extractCredentialInputs(form: HTMLFormElement): {
      usernameInput: HTMLInputElement | null;
      passwordInput: HTMLInputElement | null;
    } {
      let usernameInput: HTMLInputElement | null = null;
      let passwordInput: HTMLInputElement | null = null;
      for (const input of form.querySelectorAll("input")) {
        if (
          input.type === "text" ||
          input.type === "email" ||
          input.autocomplete === "username" ||
          input.name?.includes("user") ||
          input.name?.includes("email") ||
          input.id?.includes("user") ||
          input.id?.includes("email")
        ) {
          usernameInput = input;
        }
        if (input.type === "password") passwordInput = input;
      }
      return { usernameInput, passwordInput };
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

    // ── Floating field icon ──────────────────────────────────────────────
    const iconHost = document.createElement("div");
    iconHost.style.cssText =
      "position:absolute;z-index:2147483646;display:none;width:0;height:0;";
    const iconRoot = iconHost.attachShadow({ mode: "open" });
    const iconBtn = document.createElement("button");
    iconBtn.type = "button";
    iconBtn.setAttribute("aria-label", "Fill from vaultctl");
    iconBtn.innerHTML = emblemSVG();
    iconBtn.style.cssText = `all:unset;position:fixed;cursor:pointer;width:22px;height:22px;border-radius:6px;background:${BRAND};display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.3);`;
    iconRoot.appendChild(iconBtn);
    document.body.appendChild(iconHost);

    let activeForm: HTMLFormElement | null = null;
    let activeInput: HTMLInputElement | null = null;

    function positionIcon(input: HTMLInputElement) {
      const r = input.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        iconHost.style.display = "none";
        return;
      }
      iconBtn.style.left = `${r.right - 28}px`;
      iconBtn.style.top = `${r.top + (r.height - 22) / 2}px`;
      iconHost.style.display = "block";
    }

    function hideIcon() {
      iconHost.style.display = "none";
      activeInput = null;
    }

    iconBtn.addEventListener("mousedown", (e) => e.preventDefault());
    iconBtn.addEventListener("click", () => {
      if (!activeForm) return;
      if (matches.length === 1) {
        void fillWithMatch(activeForm, matches[0]!);
        hideIcon();
      } else if (matches.length > 1) {
        showPicker();
      }
    });

    document.addEventListener(
      "focusin",
      (e) => {
        const target = e.target as HTMLElement;
        if (!settings.fieldIcon || matches.length === 0) return;
        if (!(target instanceof HTMLInputElement)) return;
        const form = target.closest("form") as HTMLFormElement | null;
        if (!form) return;
        const { usernameInput, passwordInput } = extractCredentialInputs(form);
        if (target !== usernameInput && target !== passwordInput) return;
        activeForm = form;
        activeInput = target;
        positionIcon(target);
      },
      true,
    );
    document.addEventListener(
      "focusout",
      () =>
        setTimeout(() => {
          if (document.activeElement !== activeInput) hideIcon();
        }, 150),
      true,
    );
    window.addEventListener(
      "scroll",
      () => activeInput && positionIcon(activeInput),
      true,
    );
    window.addEventListener("resize", () => activeInput && positionIcon(activeInput));

    // ── Multi-match picker ───────────────────────────────────────────────
    function showPicker() {
      if (!activeInput || !activeForm) return;
      const form = activeForm;
      const anchor = activeInput;
      removePicker();
      const host = document.createElement("div");
      host.id = "vaultctl-picker-host";
      const root = host.attachShadow({ mode: "open" });
      const r = anchor.getBoundingClientRect();
      const menu = document.createElement("div");
      menu.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + 4}px;min-width:${Math.max(200, r.width)}px;background:#101013;color:#fafafa;border:1px solid #26262b;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.4);font:13px system-ui,sans-serif;overflow:hidden;z-index:2147483647;`;
      for (const m of matches) {
        const row = document.createElement("button");
        row.type = "button";
        row.style.cssText =
          "all:unset;display:block;width:100%;box-sizing:border-box;padding:8px 12px;cursor:pointer;";
        row.textContent = m.username || m.name || "(no username)";
        row.addEventListener("mouseenter", () => (row.style.background = "#1f1f23"));
        row.addEventListener(
          "mouseleave",
          () => (row.style.background = "transparent"),
        );
        row.addEventListener("click", () => {
          void fillWithMatch(form, m);
          removePicker();
          hideIcon();
        });
        menu.appendChild(row);
      }
      root.appendChild(menu);
      document.body.appendChild(host);
      setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
    }
    function onDocClick(e: Event) {
      if ((e.target as HTMLElement)?.id !== "vaultctl-picker-host") removePicker();
    }
    function removePicker() {
      document.getElementById("vaultctl-picker-host")?.remove();
      document.removeEventListener("click", onDocClick, true);
    }

    // ── Strong-password suggestion (new-password fields) ──────────────────
    function isNewPasswordField(
      input: HTMLInputElement,
      form: HTMLFormElement,
    ): boolean {
      if (input.type !== "password") return false;
      const ac = (input.autocomplete || "").toLowerCase();
      if (ac === "current-password") return false;
      if (ac === "new-password") return true;
      const hint = `${input.name} ${input.id} ${
        input.getAttribute("aria-label") ?? ""
      }`.toLowerCase();
      if (/new|confirm|sign[\s-]?up|register|create/.test(hint)) return true;
      return form.querySelectorAll('input[type="password"]').length >= 2;
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
      const root = host.attachShadow({ mode: "open" });
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
        // Fill every password field in the form (covers confirm fields).
        for (const p of form.querySelectorAll('input[type="password"]')) {
          setInputValue(p as HTMLInputElement, pw);
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
      onAction: () => Promise<{ ok?: boolean; error?: string }>;
    }) {
      document.getElementById("vaultctl-toast-host")?.remove();
      const host = document.createElement("div");
      host.id = "vaultctl-toast-host";
      const root = host.attachShadow({ mode: "open" });
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
      actions.append(dismiss, action);
      card.append(row, actions);
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
        let res: { ok?: boolean; error?: string };
        try {
          res = await opts.onAction();
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

      dismiss.addEventListener("click", close);
      action.addEventListener("click", () => void submit());
      setTimeout(close, Math.max(2000, settings.toastMs));
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

    function handleSubmit(event: Event) {
      const form = event.target as HTMLFormElement | null;
      if (!form || form.tagName !== "FORM") return;
      const { usernameInput, passwordInput } = extractCredentialInputs(form);
      const origin = window.location.href;
      const host = window.location.hostname;

      // Step one of a multi-step form: an email/username with no password yet.
      // Stash it so the password step can pick it up.
      if (!passwordInput || !passwordInput.value) {
        rememberUsername(usernameInput?.value ?? "");
        return;
      }
      const password = passwordInput.value;
      const immediateUsername = usernameInput?.value ?? "";

      // Queue the durable capture FIRST and synchronously, before any await.
      // A submit usually navigates the page (redirect to a dashboard), which
      // tears down this content script; anything dispatched after an await can
      // be lost. The background persists this capture and raises a notification
      // + toolbar badge, so the credential is never silently dropped — the user
      // can still confirm and save it from the popup even after the redirect.
      // The background fills in a remembered email when this step carried none.
      void bg({
        type: "loginSubmitted",
        url: origin,
        username: immediateUsername,
        password,
      });

      void (async () => {
        let username = immediateUsername;
        if (!username) {
          // Password-only step: fall back to the email captured earlier.
          const r = await bg<{ username?: string }>({
            type: "getRememberedUsername",
            host,
          });
          username = r?.username ?? "";
        }

        if (!settings.savePrompt) return;
        const d = await bg<{
          ok?: boolean;
          action?: string;
          vaultId?: string;
          itemId?: string;
          name?: string;
        }>({ type: "saveDecision", origin, username, password });
        if (!d?.ok || !d.action || d.action === "none") return;
        if (d.action === "add") {
          showToast({
            message: `Save this login for ${host} to vaultctl?`,
            actionLabel: "Save",
            successMessage: `Locked ${host} in your vault`,
            onAction: () =>
              bg<{ ok?: boolean; error?: string }>({
                type: "commitSave",
                action: "add",
                host,
                username,
                password,
                uri: origin,
              }),
          });
        } else if (d.action === "update") {
          showToast({
            message: `Update the saved password for ${username || host}?`,
            actionLabel: "Update",
            successMessage: `Updated and locked ${username || host}`,
            onAction: () =>
              bg<{ ok?: boolean; error?: string }>({
                type: "commitSave",
                action: "update",
                vaultId: d.vaultId,
                itemId: d.itemId,
                username,
                password,
              }),
          });
        }
      })();
    }

    function attachSubmitListeners() {
      for (const form of findLoginForms()) {
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
    // field), so findLoginForms ignores it and focusout alone is unreliable —
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
      }>({ type: "matchCredentials", origin: window.location.href });
      if (res?.settings) settings = res.settings;
      matches = res?.matches ?? [];
      if (settings.autofill && matches.length >= 1) {
        const forms = findLoginForms();
        if (forms[0]) void fillWithMatch(forms[0], matches[0]!);
      }
    }

    // Popup-initiated explicit fill (existing behaviour).
    browser.runtime.onMessage.addListener(
      (message: { type: string; username?: string; password?: string }) => {
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

    attachSubmitListeners();
    void refreshMatches();

    const mutationObserver = new MutationObserver(() => attachSubmitListeners());
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    ctx.onInvalidated(() => mutationObserver.disconnect());

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
