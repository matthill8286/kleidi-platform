import el from "./locales/el.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };
import ru from "./locales/ru.json" with { type: "json" };

export const SUPPORTED_LOCALES = ["en", "el", "ru"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const resources = {
  en: { translation: en },
  el: { translation: el },
  ru: { translation: ru },
} as const;

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  el: "Ελληνικά",
  ru: "Русский",
};
