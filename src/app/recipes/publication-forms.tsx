"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { publishRecipeAction, savePublicationAction, withdrawPublicationAction } from "@/server/publication-actions";
import type { FormState } from "@/server/profile-actions";

/** The one place a publication error becomes a sentence somebody can read. */
function useErrorText() {
  const errors = useTranslations("errors");
  const sharing = useTranslations("sharing.errors");
  return (error: string) => {
    if (error.startsWith("publication.")) return sharing(error.slice("publication.".length) as "draft");
    if (error.startsWith("portion.")) return errors(error as "portion.unknown-unit");
    return errors(error as "validation");
  };
}

function ErrorNotice({ error }: { error?: string }) {
  const text = useErrorText();
  if (!error) return null;
  return (
    <div className="notice notice-error" role="alert">
      <span>{text(error)}</span>
    </div>
  );
}

/**
 * Publishes a recipe, showing exactly what will be public before it is.
 *
 * The title, description and instructions are editable here rather than taken
 * from the recipe: a private note to yourself ("Mamas Rezept, zu salzig") is not
 * what somebody wants to publish under their name, and finding that out after
 * the fact is too late.
 */
export function PublishRecipeForm({
  recipeId,
  defaults,
  republish,
}: {
  recipeId: string;
  defaults: { title: string; description: string; instructions: string; tags: string[] };
  republish: boolean;
}) {
  const t = useTranslations("sharing");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<FormState, FormData>(publishRecipeAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="recipeId" value={recipeId} />
      <input type="hidden" name="confirmation" value="publish" />
      <ErrorNotice error={state.error} />
      <p className="muted">{republish ? t("republishHint") : t("publishHint")}</p>
      <div className="field">
        <label htmlFor="publish-title">{t("publishTitle")}</label>
        <input id="publish-title" name="title" defaultValue={defaults.title} maxLength={200} required />
      </div>
      <div className="field">
        <label htmlFor="publish-description">{t("publishDescription")}</label>
        <textarea id="publish-description" name="description" defaultValue={defaults.description} maxLength={2000} rows={3} />
      </div>
      <div className="field">
        <label htmlFor="publish-instructions">{t("publishInstructions")}</label>
        <textarea id="publish-instructions" name="instructions" defaultValue={defaults.instructions} maxLength={20_000} rows={6} />
      </div>
      <div className="field">
        <label htmlFor="publish-tags">{t("publishTags")}</label>
        <input id="publish-tags" name="tags" defaultValue={defaults.tags.join(", ")} />
      </div>
      <p className="muted">{t("publishNotice")}</p>
      <button className="btn btn-primary" disabled={pending}>
        {pending ? common("loading") : republish ? t("republish") : t("publish")}
      </button>
    </form>
  );
}

export function WithdrawPublicationForm({ id, recipeId }: { id: string; recipeId?: string }) {
  const t = useTranslations("sharing");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<FormState, FormData>(withdrawPublicationAction, {});
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(t("withdrawConfirm"))) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      {recipeId ? <input type="hidden" name="recipeId" value={recipeId} /> : null}
      <ErrorNotice error={state.error} />
      <button className="btn" disabled={pending}>
        {pending ? common("loading") : t("withdraw")}
      </button>
    </form>
  );
}

export function SavePublicationForm({ id, alreadySaved }: { id: string; alreadySaved: boolean }) {
  const t = useTranslations("sharing");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState<FormState, FormData>(savePublicationAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <ErrorNotice error={state.error} />
      {alreadySaved ? <p className="muted">{t("alreadySavedHint")}</p> : null}
      <button className="btn btn-primary btn-block" disabled={pending}>
        {pending ? common("loading") : alreadySaved ? t("saveAgain") : t("save")}
      </button>
    </form>
  );
}
