// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_NAMES,
  changeLanguage,
  currentLanguage,
  type Language,
} from "@/lib/i18n";

export function LanguageSwitcher() {
  const { t } = useTranslation("settings");

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Languages className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">{t("language.title")}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t("language.description")}</p>
      <div className="flex items-center gap-2">
        <label htmlFor="language-select" className="text-sm font-medium">
          {t("language.label")}
        </label>
        <select
          id="language-select"
          value={currentLanguage()}
          onChange={(e) => void changeLanguage(e.target.value as Language)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
        >
          {SUPPORTED_LANGUAGES.map((lng) => (
            <option key={lng} value={lng}>
              {LANGUAGE_NAMES[lng]}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
