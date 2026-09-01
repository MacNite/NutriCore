import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";

export default async function RecipesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  redirect("/foods#recipes");
}
