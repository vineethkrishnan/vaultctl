// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Human-readable device labels for sessions.
 *
 * At login we capture a friendly label ("Chrome 142 · macOS 15") using
 * high-entropy client hints when available (Chromium), falling back to a
 * small user-agent parser. The sessions panel also runs stored values
 * through `humanizeDeviceName` so older rows that hold a raw user-agent
 * still render cleanly.
 */

interface UADataBrand {
  brand: string;
  version: string;
}
interface HighEntropy {
  platform?: string;
  platformVersion?: string;
  fullVersionList?: UADataBrand[];
}
interface UAData {
  brands?: UADataBrand[];
  getHighEntropyValues?: (hints: string[]) => Promise<HighEntropy>;
}

// Pick the brand to show from a client-hints list. Every Chromium browser lists
// the generic engine name "Chromium" alongside its own product brand (Dia,
// Google Chrome, Microsoft Edge), so prefer the specific one and fall back to
// Chromium only when it is the sole real brand. GREASE placeholders are dropped.
export function pickBrand(list: UADataBrand[]): UADataBrand | undefined {
  const real = list.filter((b) => isRealBrand(b.brand));
  return real.find((b) => !/^chromium$/i.test(b.brand.trim())) ?? real[0];
}

export function isRealBrand(brand: string): boolean {
  // Chromium injects a GREASE placeholder brand whose letters always spell
  // "Not A Brand" but joined by random punctuation and spacing, so the exact
  // string varies by build: "Not;A=Brand" (Dia), "Not/A)Brand", " Not A;Brand",
  // "(Not(A:Brand)", "Not?A_Brand", and so on. Reducing to just the letters
  // catches every variant, where the old separator-specific regex missed most.
  return brand.replace(/[^a-z]/gi, "").toLowerCase() !== "notabrand";
}

function major(version: string | undefined): string {
  return (version ?? "").split(".")[0] ?? "";
}

function formatOS(platform: string | undefined, version: string | undefined): string {
  if (!platform) return "";
  const v = major(version);
  if (!v || v === "0") return platform;
  return `${platform} ${v}`;
}

/** Build a friendly label for the current device at login time. */
export async function deviceLabel(): Promise<string> {
  const uaData = (navigator as Navigator & { userAgentData?: UAData })
    .userAgentData;
  if (uaData?.getHighEntropyValues) {
    try {
      const hints = await uaData.getHighEntropyValues([
        "platform",
        "platformVersion",
        "fullVersionList",
      ]);
      const list = hints.fullVersionList ?? uaData.brands ?? [];
      const brand = pickBrand(list);
      const os = formatOS(hints.platform, hints.platformVersion);
      if (brand) {
        const name = `${brand.brand} ${major(brand.version)}`.trim();
        return os ? `${name} · ${os}` : name;
      }
    } catch {
      // fall through to UA parsing
    }
  }
  return parseUA(navigator.userAgent);
}

/** Turn a stored device name into a readable label. */
export function humanizeDeviceName(stored: string): string {
  if (!stored) return "Unknown device";
  // Already friendly (not a raw user-agent string).
  if (!/Mozilla|AppleWebKit|Gecko\//.test(stored)) return stored;
  return parseUA(stored);
}

function parseUA(ua: string): string {
  const browser = parseBrowser(ua);
  const os = parseOS(ua);
  if (browser && os) return `${browser} · ${os}`;
  return browser || os || "Unknown device";
}

function parseBrowser(ua: string): string {
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Edg\/(\d+)/))) return `Edge ${m[1]}`;
  if ((m = ua.match(/OPR\/(\d+)/))) return `Opera ${m[1]}`;
  if ((m = ua.match(/Firefox\/(\d+)/))) return `Firefox ${m[1]}`;
  if ((m = ua.match(/Chrome\/(\d+)/))) return `Chrome ${m[1]}`;
  if (/Safari\//.test(ua) && (m = ua.match(/Version\/(\d+)/)))
    return `Safari ${m[1]}`;
  return "";
}

function parseOS(ua: string): string {
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Android (\d+)/))) return `Android ${m[1]}`;
  if (/iPhone|iPad|iPod/.test(ua)) {
    m = ua.match(/OS (\d+)_/);
    return m ? `iOS ${m[1]}` : "iOS";
  }
  if (/Windows NT 10/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}
