import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { getSessionUser } from "@/server/session";
import { RecipeForm } from "../recipe-form";

export default async function NewRecipePage() {
  const user = await getSessionUser(); if (!user) redirect("/login");
  const t = await getTranslations("recipes");
  return <AppShell displayName={user.displayName}><div className="page-head"><h1>{t("create")}</h1></div><RecipeForm /></AppShell>;
}
