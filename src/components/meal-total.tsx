import { formatKcal } from "@/lib/format";
import type { Locale } from "@/i18n/locales";

/**
 * What a meal holds, and - when the reader has switched the split on - the
 * share of the day it was given.
 *
 * A meal over its share is marked, but never only by colour: the warning text
 * rides along for a screen reader and as the title, because "this row is amber"
 * is not information anybody who cannot see it can act on. The daily ring still
 * carries the only figure that decides the day; a meal over its share while the
 * day is under target is a redistribution, not an overage.
 */
export function MealTotal({
  kcal,
  target,
  locale,
  unit,
  overLabel,
}: {
  kcal: number | null;
  target: number | null;
  locale: Locale;
  unit: string;
  overLabel: (amount: string) => string;
}) {
  const consumed = kcal === null ? "–" : formatKcal(kcal, locale);
  if (target === null) return <>{kcal === null ? "–" : `${consumed} ${unit}`}</>;

  const over = kcal !== null && kcal > target;
  const label = over ? overLabel(formatKcal(kcal - target, locale)) : null;

  return (
    <span className={over ? "meal-total over" : "meal-total"} title={label ?? undefined}>
      {consumed} / {formatKcal(target, locale)} {unit}
      {label ? <span className="sr-only"> ({label})</span> : null}
    </span>
  );
}
