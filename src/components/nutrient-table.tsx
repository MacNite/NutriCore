import { getTranslations } from "next-intl/server";
import { NUTRIENTS } from "@/lib/nutrients";
import { formatNutrient } from "@/lib/format";
import type { Locale } from "@/i18n/locales";

/**
 * Renders every nutrient in the catalogue. An unknown value shows a dash with
 * an explicit "unknown" label for screen readers, never a zero.
 */
export async function NutrientTable({
  nutrients,
  basisAmount,
  basisUnit,
  locale,
}: {
  nutrients: Record<string, number | null>;
  basisAmount: number;
  basisUnit: string;
  locale: Locale;
}) {
  const t = await getTranslations("nutrients");
  const common = await getTranslations("common");
  const foods = await getTranslations("foods");

  const rows = NUTRIENTS.filter((n) => nutrients[n.key] !== undefined || n.category !== "vitamin");

  return (
    <div className="table-scroll">
      <table className="table">
        <caption className="sr-only">
          {foods("perBasis", { amount: String(basisAmount), unit: basisUnit === "ML" ? "ml" : "g" })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{foods("form.nutrients")}</th>
            <th scope="col" className="num">
              {foods("perBasis", { amount: String(basisAmount), unit: basisUnit === "ML" ? "ml" : "g" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((nutrient) => {
            const value = nutrients[nutrient.key] ?? null;
            return (
              <tr key={nutrient.key}>
                <th scope="row" style={{ fontWeight: 500 }}>
                  {t(nutrient.key as "protein")}
                </th>
                <td className="num">
                  {value === null ? (
                    <>
                      <span aria-hidden="true">–</span>
                      <span className="sr-only">{common("unknown")}</span>
                    </>
                  ) : (
                    `${formatNutrient(value, locale)} ${nutrient.unit}`
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
