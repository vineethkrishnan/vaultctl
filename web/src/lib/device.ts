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

function isRealBrand(brand: string): boolean {
  // Chromium injects a "Not?A_Brand" / "(Not(A:Brand)" placeholder.
  return !/not[?.\s]*a[\s)]*brand/i.test(brand);
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
      const brand = list.find((b) => isRealBrand(b.brand));
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
