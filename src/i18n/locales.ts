export const LOCALES = ["de", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale =
  process.env.DEFAULT_LOCALE === "en" ? "en" : "de";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

export const LOCALE_LABELS: Record<Locale, string> = { de: "Deutsch", en: "English" };
