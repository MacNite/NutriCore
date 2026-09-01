import { getTranslations } from "next-intl/server";
import { MEALS } from "@/server/diary";
import { queueMealInputAction } from "@/server/meal-ai-actions";
import { imageUploadMaxMb } from "@/lib/image-upload-limit";

export async function QuickMealForm({ date, returnTo }: { date: string; returnTo: "/" }) {
  const t = await getTranslations("diary");

  return (
    <form action={queueMealInputAction} encType="multipart/form-data">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="field">
        <label htmlFor={"mealText-today"}>{t("ai.describe")}</label>
        <textarea
          id={"mealText-today"}
          name="text"
          maxLength={2000}
          placeholder={t("ai.placeholder")}
        />
      </div>
      <div className="field">
        <label htmlFor="mealImage-today">{t("ai.image")}</label>
        <input
          id="mealImage-today"
          name="image"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="mealImageHint-today"
        />
        <span className="hint" id="mealImageHint-today">{t("ai.imageHint", { maxMb: imageUploadMaxMb() })}</span>
      </div>
      <div className="field">
        <label htmlFor={"sourceUrl-today"}>{t("ai.sourceUrl")}</label>
        <input
          id={"sourceUrl-today"}
          name="sourceUrl"
          type="url"
          maxLength={500}
          aria-describedby="sourceUrlHint-today"
          placeholder="https://…"
        />
        <span className="hint" id="sourceUrlHint-today">{t("ai.sourceUrlHint")}</span>
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
