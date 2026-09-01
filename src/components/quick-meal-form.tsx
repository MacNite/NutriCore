import { getTranslations } from "next-intl/server";
import { MEALS } from "@/server/diary";
import { queueMealInputAction } from "@/server/meal-ai-actions";

export async function QuickMealForm({ date, returnTo }: { date: string; returnTo: "/" | "/diary" }) {
  const t = await getTranslations("diary");

  return (
    <form action={queueMealInputAction}>
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="field">
        <label htmlFor={`mealText-${returnTo === "/" ? "today" : "diary"}`}>{t("ai.describe")}</label>
        <textarea
          id={`mealText-${returnTo === "/" ? "today" : "diary"}`}
          name="text"
          required
          maxLength={2000}
          placeholder={t("ai.placeholder")}
        />
      </div>
      <div className="field">
        <label htmlFor={`sourceUrl-${returnTo === "/" ? "today" : "diary"}`}>{t("ai.sourceUrl")}</label>
        <input
          id={`sourceUrl-${returnTo === "/" ? "today" : "diary"}`}
          name="sourceUrl"
          type="url"
          placeholder="https://…"
        />
      </div>
      <div className="field">
        <label htmlFor={`mealType-${returnTo === "/" ? "today" : "diary"}`}>{t("ai.meal")}</label>
        <select id={`mealType-${returnTo === "/" ? "today" : "diary"}`} name="meal">
          {MEALS.map((meal) => (
            <option value={meal} key={meal}>
              {t(`meals.${meal}`)}
            </option>
          ))}
        </select>
      </div>
      <button className="btn btn-primary">{t("ai.submit")}</button>
    </form>
  );
}
