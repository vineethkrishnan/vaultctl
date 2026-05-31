<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Web Store listing copy

Reference text for the Chrome Web Store and Firefox AMO dashboards. Copy these into the listing forms. None of this ships in the extension package.

- **Privacy policy URL:** https://vaultctl.vinelabs.de/privacy
- **Homepage URL:** https://vaultctl.vinelabs.de
- **Support email:** support@vinelabs.de
- **Category:** Productivity (Chrome) / Privacy & Security (Firefox)
- **Upload artifacts:** `.output/vaultctlextension-0.0.1-chrome.zip`, `.output/vaultctlextension-0.0.1-firefox.zip`, sources: `.output/vaultctlextension-0.0.1-sources.zip`

## Name

```
VaultCTL: Password Vault
```

## Short description (under 132 characters)

```
Self-hosted, zero-knowledge password manager: autofill, capture and generate logins, all encrypted in your browser.
```

## Detailed description

```
VaultCTL is the browser companion for your self-hosted VaultCTL password vault.

It is zero-knowledge by design: your master password and the keys derived from it never leave your device. Everything is encrypted and decrypted locally, so the server you run only ever stores ciphertext and can never read your vault.

FEATURES
- Autofill: a discreet inline icon fills matching logins, or fill explicitly from the popup. Optional autofill on page load.
- Capture and save: after you sign in, VaultCTL offers to save new logins or update changed passwords. Pending logins queue in the Alerts tab.
- Password generator: create strong passwords with configurable length and character sets, with recent history kept in memory only.
- Strong-password suggestions on signup and change-password forms.
- Auto-lock after a configurable period of inactivity, clearing keys from memory.
- Clipboard auto-clear: copied credentials are wiped from the clipboard after 30 seconds.

PRIVACY
- No analytics, no telemetry, no tracking, no ads.
- No remote code: all logic, including Argon2 key derivation, is bundled.
- The extension talks only to the VaultCTL server you configure. Nothing is sent to the developer or any third party.

You need a running VaultCTL server to use this extension. VaultCTL is open source (AGPL-3.0).

Source: https://github.com/vineethkrishnan/vaultctl
Privacy policy: https://vaultctl.vinelabs.de/privacy
```

## Single-purpose statement

```
VaultCTL is a password manager. Its single purpose is to let you fill, capture, and generate login credentials stored in your self-hosted VaultCTL vault, with all encryption performed locally in the browser.
```

## Permission justifications

Paste each justification next to its permission in the Chrome Web Store "Privacy practices" tab.

| Permission | Justification |
|------------|---------------|
| `storage` | Stores the user-chosen server URL, extension preferences, and a memory-only unlocked session. No personal data is sent anywhere. |
| `activeTab` | Lets the extension act on the page the user is currently interacting with when they invoke autofill or submit a login. |
| `scripting` | Injects the autofill/save logic that reads login form fields to match stored credentials and fill them when the user acts. |
| `host permissions (<all_urls>)` | A password manager must be able to detect and fill credentials on any website where the user has a saved login. The content script only inspects form fields to match and fill credentials; it does not read page content for any other purpose and does not track browsing. |
| `clipboardWrite` | Copies a username or password to the clipboard when the user clicks copy. The clipboard is auto-cleared after 30 seconds. |
| `notifications` | Shows an optional prompt offering to save a login the user just submitted. |

## Data-use disclosure (dashboard certification)

- **What user data is collected:** None is collected by the developer. The extension stores the server URL, preferences, and (optionally) the user's email locally on the device, and transmits encrypted vault data only to the user-configured server.
- **Authentication information / personally identifiable information:** Handled locally and sent only to the user's own server as ciphertext / a derived auth hash. Never to the developer.
- Certify: **not sold or transferred to third parties**, **not used or transferred for purposes unrelated to the single purpose**, **not used to determine creditworthiness or for lending**.

## Remaining manual steps (dashboard only)

1. Register a Chrome Web Store developer account (one-time 5 USD fee). Firefox AMO is free.
2. Upload the zip(s) above.
3. Upload the screenshots in `store-screenshots/` (1-login, 2-vault, 3-generator, 4-alerts, 5-settings; each 1280x800). Regenerate them with `node gen-screenshots.mjs` after a `npm run build`. A 440x280 small promo tile is optional.
4. Paste the copy and permission justifications above; complete the data-use form.
5. Submit for review. Broad host access (`<all_urls>`) may extend review time.
