import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { getSessionUser } from "@/server/session";
import { getRecipe } from "@/server/recipes";
import { RecipeForm } from "../../recipe-form";

export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(); if (!user) redirect("/login"); const { id } = await params;
  const detail = await getRecipe(user.id, id); if (!detail) notFound(); const { recipe } = detail;
  const t = await getTranslations("recipes");
  return <AppShell displayName={user.displayName}><div className="page-head"><h1>{t("edit")}</h1></div><RecipeForm recipe={{ id: recipe.id, name: recipe.name, description: recipe.description ?? "", servings: Number(recipe.servings), yieldWeightG: recipe.yieldWeightG ? Number(recipe.yieldWeightG) : null, instructions: recipe.instructions ?? "", tags: recipe.tags, ingredients: recipe.ingredients.map((item) => ({ foodId: item.foodId, name: item.food.name, amount: Number(item.amount), unit: item.unit })) }} /></AppShell>;
}
