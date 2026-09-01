/**
 * Curated from the 2024 Adult Compendium of Physical Activities.
 * Codes are retained to make every MET snapshot auditable against the source.
 * https://pacompendium.com/adult-compendium/
 */
export const ACTIVITIES = [
  { key: "walking", variants: [{ key: "slow", met: 2.8, code: "17152" }, { key: "normal", met: 3.8, code: "17190" }, { key: "brisk", met: 4.8, code: "17220" }] },
  { key: "running", variants: [{ key: "eightKph", met: 8.5, code: "12030" }, { key: "tenKph", met: 10.5, code: "12050" }, { key: "twelveKph", met: 12.5, code: "12070" }] },
  { key: "cycling", variants: [{ key: "leisure", met: 4.0, code: "01010" }, { key: "moderate", met: 8.0, code: "01040" }, { key: "vigorous", met: 10.0, code: "01050" }] },
  { key: "hiking", variants: [{ key: "general", met: 5.3, code: "17080" }] },
  { key: "strength", variants: [{ key: "general", met: 3.5, code: "02054" }, { key: "vigorous", met: 6.0, code: "02050" }] },
  { key: "calisthenics", variants: [{ key: "moderate", met: 3.8, code: "02030" }, { key: "vigorous", met: 7.5, code: "02020" }] },
  { key: "hiit", variants: [{ key: "vigorous", met: 11.0, code: "02041" }] },
  { key: "swimming", variants: [{ key: "leisure", met: 6.0, code: "18310" }, { key: "freestyleModerate", met: 8.0, code: "18350" }, { key: "freestyleFast", met: 10.0, code: "18360" }] },
  { key: "rowing", variants: [{ key: "moderate", met: 5.0, code: "02071" }, { key: "vigorous", met: 7.5, code: "02073" }] },
  { key: "elliptical", variants: [{ key: "moderate", met: 5.0, code: "02048" }] },
  { key: "stairs", variants: [{ key: "general", met: 6.8, code: "17133" }] },
  { key: "yoga", variants: [{ key: "hatha", met: 2.3, code: "02150" }, { key: "power", met: 4.0, code: "02165" }] },
  { key: "pilates", variants: [{ key: "general", met: 2.8, code: "02140" }] },
  { key: "soccer", variants: [{ key: "casual", met: 7.0, code: "15610" }, { key: "competitive", met: 10.0, code: "15605" }] },
  { key: "basketball", variants: [{ key: "general", met: 7.5, code: "15090" }] },
  { key: "tennis", variants: [{ key: "doubles", met: 6.0, code: "15675" }, { key: "singles", met: 8.0, code: "15670" }] },
  { key: "badminton", variants: [{ key: "social", met: 5.5, code: "15030" }, { key: "competitive", met: 7.0, code: "15040" }] },
  { key: "climbing", variants: [{ key: "ascending", met: 8.0, code: "15010" }] },
  { key: "skiing", variants: [{ key: "moderate", met: 6.0, code: "19160" }, { key: "vigorous", met: 8.0, code: "19170" }] },
  { key: "snowboarding", variants: [{ key: "general", met: 5.3, code: "19252" }] },
  { key: "dancing", variants: [{ key: "social", met: 4.5, code: "03010" }, { key: "aerobic", met: 7.3, code: "03015" }] },
] as const;

export type ActivityKey = (typeof ACTIVITIES)[number]["key"];
export function findActivityVariant(activityKey: string, variantKey: string) {
  const activity = ACTIVITIES.find((item) => item.key === activityKey);
  const variant = activity?.variants.find((item) => item.key === variantKey);
  return activity && variant ? { activity, variant } : null;
}
