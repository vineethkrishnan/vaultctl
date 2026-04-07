/**
 * Content script for autofill.
 *
 * Runs in the page context (isolated world). Detects login forms and
 * communicates with the background service worker to fill credentials.
 */

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    // Detect login forms on the page
    function findLoginForms(): HTMLFormElement[] {
      const forms = document.querySelectorAll("form");
      const loginForms: HTMLFormElement[] = [];

      for (const form of forms) {
        const passwordInput = form.querySelector(
          'input[type="password"]',
        );
        if (passwordInput) {
          loginForms.push(form);
        }
      }
      return loginForms;
    }

    // Fill a form with credentials
    function fillForm(
      form: HTMLFormElement,
      username: string,
      password: string,
    ) {
      // Find username field: input[type=text|email] that appears before the password field
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

    // Detect forms and notify background that this page has a login form
    const forms = findLoginForms();
    if (forms.length > 0) {
      browser.runtime.sendMessage({
        type: "loginFormDetected",
        url: window.location.href,
        formCount: forms.length,
      }).catch(() => {});
    }
  },
});
