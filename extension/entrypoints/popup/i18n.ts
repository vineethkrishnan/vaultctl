// SPDX-License-Identifier: AGPL-3.0-or-later

// Extension popup i18n. Unlike the web app's lazy dynamic-import backend, the
// popup is tiny, so locale JSON is bundled statically to avoid extension
// bundling complications. Detection reads the persisted choice from
// browser.storage.local (set by the language switcher), falling back to
// navigator.language.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enPopup from "./locales/en/popup.json";
import enCommon from "./locales/en/common.json";
import dePopup from "./locales/de/popup.json";
import deCommon from "./locales/de/common.json";

export const SUPPORTED_LANGUAGES = ["en", "de"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  de: "Deutsch",
};

export const LANGUAGE_STORAGE_KEY = "vaultctl_lang";

const resources = {
  en: { popup: enPopup, common: enCommon },
  de: { popup: dePopup, common: deCommon },
} as const;

function normalizeLanguage(value: string | undefined): Language {
  const base = (value ?? "").slice(0, 2).toLowerCase();
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base)
    ? (base as Language)
    : "en";
}

async function detectInitialLanguage(): Promise<Language> {
  try {
    const stored = await browser.storage.local.get(LANGUAGE_STORAGE_KEY);
    const saved = stored[LANGUAGE_STORAGE_KEY] as string | undefined;
    if (saved) return normalizeLanguage(saved);
  } catch {
    // storage unavailable - fall through to navigator
  }
  return normalizeLanguage(navigator.language);
}

export const i18nReady: Promise<unknown> = detectInitialLanguage().then((lng) =>
  i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: ["popup", "common"],
    defaultNS: "popup",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  }),
);

export async function changeLanguage(lng: Language): Promise<void> {
  await i18n.changeLanguage(lng);
  try {
    await browser.storage.local.set({ [LANGUAGE_STORAGE_KEY]: lng });
  } catch {
    // best effort - the language still applies for this session
  }
}

export function currentLanguage(): Language {
  return normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
}

export default i18n;
