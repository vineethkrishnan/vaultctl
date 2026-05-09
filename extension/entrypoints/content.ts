// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Content script for autofill and save-on-submit capture.
 *
 * Runs in the page context (isolated world). Detects login forms, fills them
 * on demand, and intercepts submits to offer "save to vaultctl" via the
 * background service worker.
 */

function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[vaultctl:cs]", ...args);
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    const observedForms = new WeakSet<HTMLFormElement>();

    // Detect login forms on the page
    function findLoginForms(): HTMLFormElement[] {
      const forms = document.querySelectorAll("form");
      const loginForms: HTMLFormElement[] = [];

      for (const form of forms) {
        const passwordInput = form.querySelector('input[type="password"]');
        if (passwordInput) {
          loginForms.push(form);
        }
      }
      return loginForms;
    }

    // Locate username + password inputs within a form using the same heuristics
    // used by fillForm, so capture and fill stay in sync.
    function extractCredentialInputs(form: HTMLFormElement): {
      usernameInput: HTMLInputElement | null;
      passwordInput: HTMLInputElement | null;
    } {
      const inputs = form.querySelectorAll("input");
      let usernameInput: HTMLInputElement | null = null;
      let passwordInput: HTMLInputElement | null = null;

      for (const input of inputs) {
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
        if (input.type === "password") {
          passwordInput = input;
        }
      }
      return { usernameInput, passwordInput };
    }

    // Fill a form with credentials
    function fillForm(
      form: HTMLFormElement,
      username: string,
      password: string,
    ) {
      const { usernameInput, passwordInput } = extractCredentialInputs(form);
      if (usernameInput && username) {
        setInputValue(usernameInput, username);
      }
      if (passwordInput && password) {
        setInputValue(passwordInput, password);
      }
    }

    // Set input value and dispatch events for React/Angular/Vue compatibility
    function setInputValue(input: HTMLInputElement, value: string) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, value);
      } else {
        input.value = value;
      }

      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Capture on submit — read credentials out of the form BEFORE the
    // browser navigates away. v1 treats this as a fire-and-forget ping: the
    // background queues the capture in module memory and the popup offers
    // a "Save captured login" entry.
    function handleSubmit(event: Event) {
      const form = event.target as HTMLFormElement | null;
      if (!form || form.tagName !== "FORM") return;

      const { usernameInput, passwordInput } = extractCredentialInputs(form);
      if (!passwordInput || !passwordInput.value) return;

      const username = usernameInput?.value ?? "";
      const password = passwordInput.value;

      browser.runtime
        .sendMessage({
          type: "loginSubmitted",
          url: window.location.href,
          username,
          password,
        })
        .catch(() => {});
    }

    function attachSubmitListeners() {
      for (const form of findLoginForms()) {
        if (observedForms.has(form)) continue;
        observedForms.add(form);
        form.addEventListener("submit", handleSubmit, { capture: true });
      }
    }

    // Listen for fill requests from the popup/background
    browser.runtime.onMessage.addListener(
      (message: { type: string; username?: string; password?: string }) => {
        if (message.type === "fill") {
          const forms = findLoginForms();
          if (forms.length > 0 && message.username && message.password) {
            fillForm(forms[0]!, message.username, message.password);
          }
        }
      },
    );

    // Initial pass: wire up existing forms
    attachSubmitListeners();

    // SPA navigations and late-rendered forms: re-scan on DOM mutations
    const mutationObserver = new MutationObserver(() => attachSubmitListeners());
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Notify the background that this page has a login form
    const forms = findLoginForms();
    if (forms.length > 0) {
      devLog("found", forms.length, "login form(s)");
      browser.runtime
        .sendMessage({
          type: "loginFormDetected",
          url: window.location.href,
          formCount: forms.length,
        })
        .catch(() => {});
    }
  },
});
