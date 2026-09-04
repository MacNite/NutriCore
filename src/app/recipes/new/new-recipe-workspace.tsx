"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AutoRefresh } from "@/components/auto-refresh";
import { CompletionRedirect } from "@/components/completion-redirect";
import { ServingsInput } from "@/components/servings-input";
import { queueRecipeImportAction, type RecipeImportDraft, type RecipeImportError } from "@/server/ai-ingestion-actions";
import { RecipeForm } from "../recipe-form";

/**
 * The extraction is queued, not awaited: a local model takes minutes, which no
 * form submission can hold open. So this is a plain form that navigates, and the
 * page it navigates to reports the state. `AutoRefresh` fills the draft in when
 * the worker is done, without the reader having to reload anything.
 */
export function NewRecipeWorkspace({
  draft,
  error,
  pending,
  failed,
  sourceFailure,
  imageMaxMb,
  destination,
  watching,
}: {
  draft: RecipeImportDraft | null;
  error?: RecipeImportError;
  pending: boolean;
  failed: string | null;
  /** A recognised URL failure, which reads better than the worker's own message. */
  sourceFailure: "noIngredients" | "unsupportedContent" | "oversizedPage" | "unreachablePage" | "unsafeUrl" | null;
  imageMaxMb: number;
  /** The recipe this run produced, once there is one to open. */
  destination: string | null;
  /** Whether the run was still going when this reader arrived. */
  watching: boolean;
}) {
  const t = useTranslations("recipes.import");

  return (
    <div className="stack">
      {/* Outside every conditional block on purpose: it has to stay mounted
          across the refresh that turns "queued" into a finished draft, because
          that is the transition it exists to follow. */}
      <CompletionRedirect href={destination} watching={watching} />
      <section className="card" aria-labelledby="recipe-import-heading">
        <div className="card-head">
          <div>
            <h2 id="recipe-import-heading">{t("title")}</h2>
            <p className="muted" style={{ margin: 0 }}>{t("hint")}</p>
          </div>
          <span className="ai-badge">AI</span>
        </div>
        <form action={queueRecipeImportAction}>
          <div className="field"><label htmlFor="recipe-import-text">{t("text")}</label><textarea id="recipe-import-text" name="text" maxLength={5000} placeholder={t("textPlaceholder")} /></div>
          <div className="field"><label htmlFor="recipe-import-url">{t("url")}</label><input id="recipe-import-url" name="sourceUrl" type="url" placeholder="https://…" /></div>
          <div className="field"><label htmlFor="recipe-import-image">{t("image")}</label><input id="recipe-import-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" /><span className="hint">{t("imageHint", { maxMb: imageMaxMb })}</span></div>
          {/* Last, and with its explanation folded into the marker beside the
              label: it is the one field that is usually left at 1, so it should
              not push the three inputs that carry the recipe down the panel. */}
          <ServingsInput
            id="recipe-import-servings"
            name="servings"
            label={t("servings")}
            hint={t("servingsHint")}
            hintPlacement="tooltip"
            hintLabel={t("servingsHintLabel")}
            decrementLabel={t("servingsDown")}
            incrementLabel={t("servingsUp")}
          />
          {error ? <div className="notice notice-error" role="alert">{t(`errors.${error}`)}</div> : null}
          <button className="btn btn-primary" disabled={pending}>{t("submit")}</button>
        </form>

        {pending ? (
          <div className="notice" style={{ marginTop: 14 }}>
            <span className="notice-icon" aria-hidden="true">i</span>
            <span>
              {t("queued")}
              <AutoRefresh />
            </span>
          </div>
        ) : null}

        {failed !== null ? (
          <div className="notice notice-error" role="alert" style={{ marginTop: 14 }}>
            <span className="notice-icon" aria-hidden="true">!</span>
            <span>
              {sourceFailure ? t(`errors.${sourceFailure}`) : t("errors.extractionFailed")}
              {failed && !sourceFailure ? <span className="job-detail-break"> — {failed}</span> : null}
            </span>
          </div>
        ) : null}

        {draft?.unmatched.length ? (
          <div className="notice notice-warn" style={{ marginTop: 14 }}>{t("unmatched", { names: draft.unmatched.join(", ") })}</div>
        ) : null}

        {draft?.unconverted?.length ? (
          <div className="notice notice-warn" style={{ marginTop: 14 }}>{t("unconverted", { names: draft.unconverted.join(", ") })}</div>
        ) : null}

        {/* In the recipe, but weighed by the model rather than by the source. */}
        {draft?.estimatedWeights?.length ? (
          <div className="notice notice-warn" style={{ marginTop: 14 }}>{t("estimatedWeights", { names: draft.estimatedWeights.join(", ") })}</div>
        ) : null}

        {draft?.unparsedIngredients?.length ? (
          <div className="notice notice-warn" style={{ marginTop: 14 }}>{t("unparsed", { names: draft.unparsedIngredients.join(", ") })}</div>
        ) : null}

        {/* Which rows to check first. The quantity on these is the source's own,
            but the food behind it is a judgement the model made. */}
        {draft?.aiAssistedIngredients?.length ? (
          <div className="notice notice-warn" style={{ marginTop: 14 }}>{t("aiAssisted", { names: draft.aiAssistedIngredients.join(", ") })}</div>
        ) : null}

        {draft?.resolutionDiagnostics ? (
          <p className="muted" style={{ marginTop: 14 }}>
            {t("resolutionSummary", {
              total: draft.resolutionDiagnostics.ingredientCount,
              deterministic: draft.resolutionDiagnostics.deterministicallyResolvedCount,
              ai: draft.resolutionDiagnostics.aiAssistedCount,
              unresolved: draft.resolutionDiagnostics.unresolvedCount,
            })}
          </p>
        ) : null}

        {/* The extraction is already stored, so leaving this page does not lose
            it - and saving below confirms that same draft rather than adding a
            second copy of it. */}
        {draft?.recipeId ? (
          <div className="notice" style={{ marginTop: 14 }}>
            <span className="notice-icon" aria-hidden="true">i</span>
            <span>{t("savedAsDraft")} <Link href={`/recipes/${draft.recipeId}`}>{t("openDraft")}</Link></span>
          </div>
        ) : null}
      </section>

      <RecipeForm
        key={draft ? JSON.stringify(draft) : "empty"}
        recipe={draft ? { ...draft, id: draft.recipeId ?? "", yieldWeightG: null, tags: [] } : undefined}
        createMode={!draft?.recipeId}
      />
    </div>
  );
}
