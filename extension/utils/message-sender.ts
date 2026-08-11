// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Classifies a runtime message sender as a web-page content script or one of
 * the extension's own pages.
 *
 * The presence of sender.tab alone cannot distinguish the two: an extension
 * page opened via windows.create (the openUnlock fallback window) is hosted in
 * a real tab and carries sender.tab, unlike the toolbar action popup. The
 * sender.url scheme+origin is the reliable discriminator, and a web page can
 * never spoof it: popup.html is not listed in web_accessible_resources, so no
 * page can iframe an extension URL into a tab.
 *
 * Fails closed: a sender with a tab but no readable url is treated as a
 * content script.
 */
export function isContentScriptSender(
  senderUrl: string | undefined,
  hasTab: boolean,
  extensionBaseUrl: string,
): boolean {
  if (!hasTab) return false;
  if (!senderUrl) return true;
  return !senderUrl.startsWith(extensionBaseUrl);
}
