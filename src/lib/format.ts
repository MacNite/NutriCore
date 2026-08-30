import type { Locale } from "@/i18n/locales";

/**
 * Locale-aware number formatting: 1.234,5 in German, 1,234.5 in English.
 * Formatters are cached because Intl construction is comparatively expensive.
 */
const cache = new Map<string, Intl.NumberFormat>();

function formatter(locale: Locale, options: Intl.NumberFormatOptions) {
  const key = `${locale}:${JSON.stringify(options)}`;
  let instance = cache.get(key);
  if (!instance) {
    instance = new Intl.NumberFormat(locale, options);
    cache.set(key, instance);
  }
  return instance;
}

export function formatNumber(value: number, locale: Locale, digits = 1) {
  return formatter(locale, { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);
}

export const formatKcal = (value: number, locale: Locale) => formatNumber(Math.round(value), locale, 0);

/** Renders an unknown value as a dash rather than as zero. */
export function formatNutrient(value: number | null | undefined, locale: Locale, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  // Sub-gram amounts still deserve a visible value.
  const resolved = Math.abs(value) > 0 && Math.abs(value) < 0.1 ? 2 : digits;
  return formatNumber(value, locale, resolved);
}

export const formatPercent = (fraction: number, locale: Locale) =>
  formatter(locale, { style: "percent", maximumFractionDigits: 0 }).format(fraction);

export function formatDate(date: Date | string, locale: Locale, options?: Intl.DateTimeFormatOptions) {
  const value = typeof date === "string" ? new Date(`${date}T00:00:00.000Z`) : date;
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...(options ?? { dateStyle: "medium" }) }).format(value);
}

export const formatWeekday = (date: Date | string, locale: Locale) =>
  formatDate(date, locale, { weekday: "short", day: "numeric", month: "long" });
