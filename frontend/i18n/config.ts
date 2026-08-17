export const locales = ["en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeCookieName = "syllogic.locale";

export const localeNameKeys = {
  en: "english",
} as const satisfies Record<Locale, string>;
