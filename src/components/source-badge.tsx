import { useTranslations } from "next-intl";

export type SourceKey =
  | "OPEN_FOOD_FACTS"
  | "USDA"
  | "BLS"
  | "FATSECRET"
  | "USER"
  | "RECIPE"
  | "AI_RESEARCH"
  | "IMPORTED";

const CLASS: Record<SourceKey, string> = {
  OPEN_FOOD_FACTS: "badge-off",
  USDA: "badge-usda",
  BLS: "badge-bls",
  FATSECRET: "badge-fatsecret",
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

export type EnrichmentBadgeData = { nutrientNames: string[]; servingSize: boolean; addedAt: string };

export function SourceBadges({ source, enrichment = [] }: { source: string; enrichment?: EnrichmentBadgeData[] }) {
  const t = useTranslations("foods");
  const names = [...new Set(enrichment.flatMap((item) => item.nutrientNames))];
  const serving = enrichment.some((item) => item.servingSize);
  const date = enrichment.map((item) => item.addedAt).sort().at(-1)?.slice(0, 10);
  const details = [...names, ...(serving ? [t("aiEnrichment.servingSize")] : [])].join(", ");
  return <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}><SourceBadge source={source} />{enrichment.length && (names.length || serving) ? <span className="badge badge-ai" title={t("aiEnrichment.tooltip", { details, date: date ?? "—" })}><span aria-hidden="true">✦</span>{t("aiEnrichment.label")}<span className="sr-only"> — {details}</span></span> : null}</span>;
}
