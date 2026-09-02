"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { confirmRecipeAction, deleteRecipeAction, logRecipeAction } from "@/server/recipe-actions";
import type { FormState } from "@/server/profile-actions";

export function LogRecipeForm({ id, date, portionWeightG }: { id: string; date: string; portionWeightG: number }) {
  const t = useTranslations("recipes"); const diary = useTranslations("diary"); const common = useTranslations("common");
  const [state, action, pending] = useActionState<FormState, FormData>(logRecipeAction, {});
  return <form action={action}><input type="hidden" name="recipeId" value={id} />{state.error ? <p role="alert">{state.error}</p> : null}<p className="muted">{t("servingSummary", { grams: portionWeightG })}</p><div className="field-row"><div className="field"><label htmlFor="quantity">{t("servingsToLog")}</label><input id="quantity" name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" required /></div><div className="field"><label htmlFor="meal">{t("meal")}</label><select id="meal" name="meal">{(["BREAKFAST", "LUNCH", "DINNER", "SNACKS"] as const).map((meal) => <option value={meal} key={meal}>{diary(`meals.${meal}`)}</option>)}</select></div><div className="field"><label htmlFor="date">{t("date")}</label><input id="date" name="date" type="date" defaultValue={date} required /></div></div><button className="btn btn-primary" disabled={pending}>{pending ? common("loading") : t("log")}</button></form>;
}
/**
 * Accepts an AI draft. The unit and portion problems a draft can carry surface
 * here as the same translated messages the recipe form shows, because this is
 * the button that first asks the database to calculate anything from it.
 */
export function ConfirmRecipeForm({ id }: { id: string }) {
  const t = useTranslations("recipes"); const common = useTranslations("common"); const errors = useTranslations("errors");
  const [state, action, pending] = useActionState<FormState, FormData>(confirmRecipeAction, {});
  return <form action={action}><input type="hidden" name="id" value={id} />{state.error ? <div className="notice notice-error" role="alert"><span>{state.error.startsWith("portion.") ? errors(state.error as "portion.unknown-unit") : errors(state.error as "validation")}</span></div> : null}<button className="btn btn-primary btn-block" disabled={pending}>{pending ? common("loading") : t("confirmDraft")}</button></form>;
}

export function DeleteRecipeForm({ id }: { id: string }) {
  const t = useTranslations("recipes"); const common = useTranslations("common"); const [state, action, pending] = useActionState<FormState, FormData>(deleteRecipeAction, {});
  return <form action={action} onSubmit={(event) => { if (!window.confirm(t("deleteConfirm"))) event.preventDefault(); }}><input type="hidden" name="id" value={id} /><input type="hidden" name="confirmation" value="delete" />{state.error ? <p role="alert">{state.error}</p> : null}<button className="btn btn-danger" disabled={pending}>{common("delete")}</button></form>;
}
