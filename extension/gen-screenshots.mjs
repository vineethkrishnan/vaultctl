// Generate Chrome Web Store screenshots (1280x800) of the popup by driving the
// built extension with a mocked `browser` global (the popup uses globalThis.browser
// when its runtime.id is truthy, so we never touch the real chrome binding).
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import fs from "node:fs";

// Playwright is a dev dependency of the web workspace, not the extension.
const require = createRequire(import.meta.url);
const { chromium } = require("../web/node_modules/@playwright/test");

const here = dirname(fileURLToPath(import.meta.url));
const extPath = resolve(here, ".output/chrome-mv3");
const outDir = resolve(here, "store-screenshots");
fs.mkdirSync(outDir, { recursive: true });
const userDir = fs.mkdtempSync(resolve(os.tmpdir(), "vaultctl-shots-"));

const SETTINGS = {
  autofill: false, fieldIcon: true, savePrompt: true, toastMs: 8000, suggestPassword: true,
  genLength: 20, genLower: true, genUpper: true, genDigits: true, genSymbols: true,
  historyMax: 5, historyTtlMin: 60, autoLockMin: 15,
};
const CAPTURES = [
  { id: "c1", url: "https://news.ycombinator.com", username: "vineeth", capturedAt: Date.now() - 4 * 60000, read: false },
  { id: "c2", url: "https://figma.com", username: "design@vinelabs.de", capturedAt: Date.now() - 26 * 60000, read: false },
  { id: "c3", url: "https://reddit.com", username: "vinelabs", capturedAt: Date.now() - 95 * 60000, read: true },
];
const ITEMS = [
  { id: "i1", itemType: "login", favorite: true, trashed: false, encryptedName: "NAME::GitHub", encryptedData: 'DATA::{"username":"vineeth@vinelabs.de","password":"x","uri":"https://github.com"}' },
  { id: "i2", itemType: "login", favorite: false, trashed: false, encryptedName: "NAME::Google", encryptedData: 'DATA::{"username":"vineeth@gmail.com","password":"x","uri":"https://accounts.google.com"}' },
  { id: "i3", itemType: "login", favorite: false, trashed: false, encryptedName: "NAME::AWS Console", encryptedData: 'DATA::{"username":"vinelabs-ops","password":"x","uri":"https://console.aws.amazon.com"}' },
  { id: "i4", itemType: "login", favorite: false, trashed: false, encryptedName: "NAME::Cloudflare", encryptedData: 'DATA::{"username":"admin@vinelabs.de","password":"x","uri":"https://dash.cloudflare.com"}' },
];

const initFn = (scene) => {
  const B = 32;
  const enc = new TextEncoder();
  const b64 = (bytes) => { let s = ""; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };
  const padded = (str) => { const d = enc.encode(str); const n = B - (d.length % B); const o = new Uint8Array(d.length + n); o.set(d, 0); o.fill(n, d.length); return o; };
  const router = (m) => {
    switch (m.type) {
      case "getServerUrl": return { url: "https://vault.vinelabs.de" };
      case "getSession": return scene.locked ? { isUnlocked: false } : { isUnlocked: true, accessToken: "tok", vaults: [{ id: "v1", name: "Personal", type: "personal" }] };
      case "getAuthState": return { isAuthenticated: !scene.locked, isUnlocked: !scene.locked, vaultCount: 1 };
      case "getCapturedLogins": return { captures: scene.captures || [] };
      case "getSettings": return { settings: scene.settings };
      case "getGenHistory": return { entries: scene.history || [] };
      case "generatePassword": return { ok: true, password: "Hh7$kPz2!qWv9mAe3" };
      case "decryptForVault": {
        const blob = String(m.blobB64 || "");
        if (blob.startsWith("NAME::")) return { ok: true, plaintextB64: b64(padded(blob.slice(6))) };
        if (blob.startsWith("DATA::")) return { ok: true, plaintextB64: b64(enc.encode(blob.slice(6))) };
        return { ok: true, plaintextB64: b64(padded("Item")) };
      }
      default: return { ok: true };
    }
  };
  const noop = () => {};
  const stub = {
    runtime: { id: "mock", getManifest: () => ({ version: "0.0.1" }), getURL: (p) => p, sendMessage: (m) => Promise.resolve(router(m)), onMessage: { addListener: noop, removeListener: noop } },
    storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() }, session: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() } },
  };
  globalThis.browser = stub;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    const u = String(url);
    if (u.includes("/items")) return Promise.resolve(new Response(JSON.stringify(scene.items || []), { status: 200, headers: { "Content-Type": "application/json" } }));
    if (u.includes("/config")) return Promise.resolve(new Response(JSON.stringify({ version: "1.6.0", registrationMode: "invite" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    return realFetch ? realFetch(url, opts) : Promise.resolve(new Response("{}", { status: 200 }));
  };
};

const FRAME = (b64img, caption) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}html,body{width:640px;height:400px;overflow:hidden}
body{background:radial-gradient(60rem 30rem at 78% -10%, rgba(45,212,191,.16), transparent 60%),#09090b;
font-family:-apple-system,system-ui,sans-serif;color:#fafafa;display:flex;align-items:center;gap:34px;padding:0 44px}
.copy{flex:1;max-width:280px}.copy h2{font-size:25px;line-height:1.18;font-weight:700;letter-spacing:-.4px}
.copy p{margin-top:10px;font-size:13.5px;line-height:1.5;color:#a1a1aa}
.tag{display:inline-block;margin-bottom:14px;font-size:10.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#2dd4bf}
.shot{flex:none;width:200px;height:300px;border-radius:18px;overflow:hidden;border:1px solid #26262b;
box-shadow:0 24px 60px rgba(0,0,0,.55),0 0 0 1px rgba(45,212,191,.10)}
.shot img{width:200px;height:300px;display:block}
</style></head><body>
<div class="copy"><span class="tag">VaultCTL</span><h2>${caption.h}</h2><p>${caption.p}</p></div>
<div class="shot"><img src="data:image/png;base64,${b64img}"/></div>
</body></html>`;

const ctx = await chromium.launchPersistentContext(userDir, {
  headless: false,
  ignoreHTTPSErrors: true,
  deviceScaleFactor: 2,
  args: ["--headless=new", `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const waitForSW = async () => { for (let i = 0; i < 50; i++) { const [s] = ctx.serviceWorkers(); if (s) return s; await new Promise(r => setTimeout(r, 200)); } return ctx.waitForEvent("serviceworker", { timeout: 5000 }); };

const scenes = [
  { file: "1-login", locked: true, settings: SETTINGS, caption: { h: "Your vault, zero-knowledge", p: "Sign in to your self-hosted VaultCTL server. Keys are derived and never leave your device." } },
  { file: "2-vault", locked: false, items: ITEMS, settings: SETTINGS, tab: "Vault", wait: "GitHub", caption: { h: "Autofill, anywhere", p: "Find and fill saved logins from the toolbar, with a click-to-fill icon right in the page." } },
  { file: "3-generator", locked: false, items: ITEMS, settings: SETTINGS, tab: "Generator", caption: { h: "Strong passwords, instantly", p: "Generate and copy strong passwords with configurable length and character sets." } },
  { file: "4-alerts", locked: false, items: ITEMS, settings: SETTINGS, captures: CAPTURES, tab: "Alerts", caption: { h: "Never lose a new login", p: "Captured logins queue in Alerts so you can save or dismiss them on your terms." } },
  { file: "5-settings", locked: false, items: ITEMS, settings: SETTINGS, tab: "Settings", caption: { h: "In your control", p: "Tune autofill, auto-lock and prompts. No telemetry, no tracking, no remote code." } },
];

try {
  const sw = await waitForSW();
  const extId = new URL(sw.url()).host;
  for (const scene of scenes) {
    const page = await ctx.newPage();
    await page.addInitScript(initFn, scene);
    await page.setViewportSize({ width: 360, height: 540 });
    await page.goto(`chrome-extension://${extId}/popup.html`);
    if (scene.tab && scene.tab !== "Vault") {
      await page.getByRole("button", { name: scene.tab }).click().catch(() => {});
    }
    if (scene.wait) await page.getByText(scene.wait, { exact: false }).first().waitFor({ timeout: 8000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 900));
    const shot = await page.screenshot({ type: "png" });
    await page.close();

    const frame = await ctx.newPage();
    await frame.setViewportSize({ width: 640, height: 400 });
    await frame.setContent(FRAME(shot.toString("base64"), scene.caption));
    await new Promise((r) => setTimeout(r, 250));
    await frame.screenshot({ path: resolve(outDir, `${scene.file}.png`) });
    await frame.close();
    console.log("wrote", `${scene.file}.png`);
  }
} finally {
  await ctx.close();
  fs.rmSync(userDir, { recursive: true, force: true });
}
console.log("done ->", outDir);
