// SPDX-License-Identifier: AGPL-3.0-or-later

// i18n setup. Translations live in src/locales/<lng>/<namespace>.json and are
// loaded lazily, one namespace at a time, via a dynamic-import backend - so a
// page pulls only "common" plus the namespaces it declares in useTranslation().

import i18n, { type BackendModule } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

export const SUPPORTED_LANGUAGES = ["en", "de"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

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

void i18n
  .use(dynamicBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: ["common"],
    defaultNS: "common",
    load: "languageOnly",
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: true },
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
