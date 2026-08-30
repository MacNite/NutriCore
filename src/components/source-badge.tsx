import { useTranslations } from "next-intl";

export type SourceKey = "OPEN_FOOD_FACTS" | "USDA" | "USER" | "RECIPE" | "AI_RESEARCH" | "IMPORTED";

const CLASS: Record<SourceKey, string> = {
  OPEN_FOOD_FACTS: "badge-off",
  USDA: "badge-usda",
  USER: "badge-user",
  RECIPE: "badge-recipe",
  AI_RESEARCH: "badge-ai",
  IMPORTED: "",
};

const KNOWN = Object.keys(CLASS) as SourceKey[];
export const asSourceKey = (value: string): SourceKey =>
  KNOWN.includes(value as SourceKey) ? (value as SourceKey) : "IMPORTED";

/**
 * Provenance is always shown as text plus (for estimates) an icon, so the
 * source is never communicated by colour alone.
 */
export function SourceBadge({ source }: { source: string }) {
  const t = useTranslations("foods");
  const key = asSourceKey(source);

  return (
    <span className={`badge ${CLASS[key]}`} title={t(`sourceFull.${key}`)}>
      {key === "AI_RESEARCH" ? <span aria-hidden="true">✦</span> : null}
      {t(`source.${key}`)}
      <span className="sr-only"> — {t(`sourceFull.${key}`)}</span>
    </span>
  );
}
