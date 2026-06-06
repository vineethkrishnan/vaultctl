// SPDX-License-Identifier: AGPL-3.0-or-later

// i18n setup. Translations live in src/locales/<lng>/<namespace>.json and are
// loaded lazily, one namespace at a time, via a dynamic-import backend - so a
// page pulls only "common" plus the namespaces it declares in useTranslation().

import i18n, { type BackendModule } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

export const SUPPORTED_LANGUAGES = ["en", "de"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

// Every namespace, kept in its own per-page JSON file. They are preloaded at
// startup rather than suspended on first use: the bundles are tiny, and
// suspending route components mid-navigation reparents the router and fires
// queries with undefined params. Add new namespaces here.
const ALL_NAMESPACES = [
  "common",
  "auth",
  "account",
  "system",
  "settings",
  "security",
  "vault",
  "notifications",
  "admin",
  "health",
] as const;

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  de: "Deutsch",
};

export const LANGUAGE_STORAGE_KEY = "vaultctl_lang";

const dynamicBackend: BackendModule = {
  type: "backend",
  init: () => {},
  read: (language: string, namespace: string) =>
    import(`../locales/${language}/${namespace}.json`).then((mod) => mod.default),
};

// i18nReady resolves once i18next is initialized and every namespace for the
// active language is loaded. main.tsx awaits it before rendering so the app
// never suspends for translations.
export const i18nReady: Promise<unknown> = i18n
  .use(dynamicBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: [...ALL_NAMESPACES],
    defaultNS: "common",
    load: "languageOnly",
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

export function changeLanguage(lng: Language): Promise<unknown> {
  return i18n.changeLanguage(lng);
}

export function currentLanguage(): Language {
  const base = (i18n.resolvedLanguage ?? i18n.language ?? "en").slice(0, 2);
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base)
    ? (base as Language)
    : "en";
}

export default i18n;
