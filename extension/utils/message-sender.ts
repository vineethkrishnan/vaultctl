// SPDX-License-Identifier: AGPL-3.0-or-later

// sender.tab alone cannot discriminate a content script from an extension page
// (a page opened via windows.create is hosted in a real tab), so trust keys
// off sender.url. That is spoof-proof only while no HTML resource is in
// web_accessible_resources - nothing lets a web page put an extension URL in a
// tab it controls - and a tab sender with no readable url fails closed.
export function isContentScriptSender(
  senderUrl: string | undefined,
  hasTab: boolean,
  extensionBaseUrl: string,
): boolean {
  if (!hasTab) return false;
  if (!senderUrl) return true;
  return !senderUrl.startsWith(extensionBaseUrl);
}
