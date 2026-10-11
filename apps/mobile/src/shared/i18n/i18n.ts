import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";

/** Initialises i18next once; every user-facing string goes through `t()` (I1). */
export function initI18n(): typeof i18n {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: { en: { translation: en } },
      lng: "en",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
    });
  }
  return i18n;
}
