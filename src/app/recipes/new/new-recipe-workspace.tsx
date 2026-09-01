"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { importRecipeAction, type RecipeImportState } from "@/server/recipe-import-actions";
import { RecipeForm } from "../recipe-form";

export function NewRecipeWorkspace() {
  const t = useTranslations("recipes.import");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<RecipeImportState, FormData>(importRecipeAction, {});

  return (
    <div className="stack">
      <section className="card" aria-labelledby="recipe-import-heading">
        <div className="card-head">
          <div><h2 id="recipe-import-heading">{t("title")}</h2><p className="muted" style={{ margin: 0 }}>{t("hint")}</p></div>
          <span className="ai-badge">AI</span>
        </div>
        <form action={action}>
          <div className="field"><label htmlFor="recipe-import-text">{t("text")}</label><textarea id="recipe-import-text" name="text" maxLength={5000} placeholder={t("textPlaceholder")} /></div>
          <div className="field"><label htmlFor="recipe-import-url">{t("url")}</label><input id="recipe-import-url" name="sourceUrl" type="url" placeholder="https://…" /></div>
          <div className="field"><label htmlFor="recipe-import-image">{t("image")}</label><input id="recipe-import-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" /><span className="hint">{t("imageHint")}</span></div>
          {state.error ? <div className="notice notice-error" role="alert">{t(`errors.${state.error}`)}</div> : null}
          <button className="btn btn-primary" disabled={pending}>{pending ? common("loading") : t("submit")}</button>
        </form>
        {state.draft?.unmatched.length ? <div className="notice notice-warn" style={{ marginTop: 14 }}>{t("unmatched", { names: state.draft.unmatched.join(", ") })}</div> : null}
      </section>

      <RecipeForm
        key={JSON.stringify(state.draft ?? {})}
        recipe={state.draft ? { ...state.draft, id: "", yieldWeightG: null, tags: [] } : undefined}
        createMode
      />
    </div>
  );
}
