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

function bg<T = unknown>(message: Record<string, unknown>): Promise<T> {
  return browser.runtime.sendMessage(message).catch(() => ({})) as Promise<T>;
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
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
    iconBtn.innerHTML = shieldSVG();
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
    function showToast(opts: {
      message: string;
      actionLabel: string;
      onAction: () => void;
    }) {
      document.getElementById("vaultctl-toast-host")?.remove();
      const host = document.createElement("div");
      host.id = "vaultctl-toast-host";
      const root = host.attachShadow({ mode: "open" });
      const card = document.createElement("div");
      card.style.cssText =
        "position:fixed;right:16px;top:16px;max-width:320px;background:#101013;color:#fafafa;border:1px solid #26262b;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px system-ui,sans-serif;padding:12px 14px;z-index:2147483647;opacity:0;transform:translateX(120%) scale(.98);transition:opacity .35s cubic-bezier(.16,1,.3,1),transform .45s cubic-bezier(.16,1,.3,1);";
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;";
      const icon = document.createElement("span");
      icon.innerHTML = shieldSVG(BRAND);
      icon.style.cssText = `flex:none;width:22px;height:22px;border-radius:6px;background:${BRAND}1a;display:flex;align-items:center;justify-content:center;`;
      const msg = document.createElement("div");
      msg.style.cssText = "flex:1;line-height:1.35;";
      msg.textContent = opts.message;
      row.append(icon, msg);
      const actions = document.createElement("div");
      actions.style.cssText =
        "display:flex;gap:8px;justify-content:flex-end;margin-top:10px;";
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
      dismiss.addEventListener("click", close);
      action.addEventListener("click", () => {
        opts.onAction();
        close();
      });
      setTimeout(close, Math.max(2000, settings.toastMs));
    }

    // ── Submit capture → save/update decision ─────────────────────────────
    function handleSubmit(event: Event) {
      const form = event.target as HTMLFormElement | null;
      if (!form || form.tagName !== "FORM") return;
      const { usernameInput, passwordInput } = extractCredentialInputs(form);
      if (!passwordInput || !passwordInput.value) return;
      const username = usernameInput?.value ?? "";
      const password = passwordInput.value;
      const origin = window.location.href;
      const host = window.location.hostname;

      // Keep the legacy capture queue alive for the popup.
      void bg({ type: "loginSubmitted", url: origin, username, password });

      if (!settings.savePrompt) return;
      void bg<{
        ok?: boolean;
        action?: string;
        vaultId?: string;
        itemId?: string;
        name?: string;
      }>({ type: "saveDecision", origin, username, password }).then((d) => {
        if (!d?.ok || !d.action || d.action === "none") return;
        if (d.action === "add") {
          showToast({
            message: `Save this login for ${host} to vaultctl?`,
            actionLabel: "Save",
            onAction: () =>
              void bg({
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
            onAction: () =>
              void bg({
                type: "commitSave",
                action: "update",
                vaultId: d.vaultId,
                itemId: d.itemId,
                username,
                password,
              }),
          });
        }
      });
    }

    function attachSubmitListeners() {
      for (const form of findLoginForms()) {
        if (observedForms.has(form)) continue;
        observedForms.add(form);
        form.addEventListener("submit", handleSubmit, { capture: true });
      }
    }

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

    if (findLoginForms().length > 0) {
      void bg({ type: "loginFormDetected", url: window.location.href });
    }
  },
});

function shieldSVG(fill = "#ffffff"): string {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="${fill}" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V5l8-3z"/></svg>`;
}
