import { asUntrustedExcerpt, ldJsonScripts, sanitizeHtml } from "@/lib/url-guard";
import { fetchResearchSource } from "./research";

export type StructuredRecipe = {
  name?: string;
  description?: string;
  yieldText?: string;
  ingredientLines: string[];
  instructions?: string;
};

export type MealPage = { url: string; title: string; excerpt: string; recipeFound: boolean; structuredRecipe?: StructuredRecipe };

/**
 * `includeInstructions` adds the recipe's description and preparation steps to
 * the excerpt. A quick meal only needs quantities, but a recipe import fills a
 * draft that has an instructions field, and dropping the steps would hand the
 * user a recipe they still have to type out.
 */
export type MealPageOptions = { includeInstructions?: boolean };

const decodeEntities = (value: string) => sanitizeHtml(value, 20_000);

function recipeObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(recipeObjects);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const nested = recipeObjects(object["@graph"]);
  const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  return types.some((type) => String(type).toLowerCase() === "recipe") ? [object, ...nested] : nested;
}

/**
 * Flattens schema.org `recipeInstructions`, which publishers write as a string,
 * a list of strings, a list of `HowToStep` objects, or `HowToSection` objects
 * that carry their steps in `itemListElement`.
 */
function instructionSteps(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return [value];
  if (depth > 3) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => instructionSteps(entry, depth + 1));
  if (!value || typeof value !== "object") return [];
  const step = value as Record<string, unknown>;
  const nested = instructionSteps(step.itemListElement, depth + 1);
  if (nested.length) return nested;
  const text = step.text ?? step.name;
  return typeof text === "string" ? [text] : [];
}

/** Extract Recipe JSON-LD before falling back to deliberately coarse visible text. */
export function extractMealPage(html: string, url: string, options: MealPageOptions = {}): MealPage {
  const recipes: Record<string, unknown>[] = [];
  for (const match of html.matchAll(ldJsonScripts())) {
    try { recipes.push(...recipeObjects(JSON.parse(match[1]))); } catch { /* malformed publisher data is ignored */ }
  }
  const recipe = recipes.find((item) => Array.isArray(item.recipeIngredient) && item.recipeIngredient.length);
  if (recipe) {
    const clean = (value: unknown, max = 20_000) => typeof value === "string" ? sanitizeHtml(value, max).trim() : undefined;
    const ingredients = (recipe.recipeIngredient as unknown[])
      .map((item) => clean(item, 300))
      .filter((item): item is string => Boolean(item))
      .slice(0, 80);
    const name = clean(recipe.name, 200);
    const description = clean(recipe.description, 2_000);
    const rawYield = Array.isArray(recipe.recipeYield) ? recipe.recipeYield.join(", ") : recipe.recipeYield;
    const yieldText = clean(rawYield, 200);
    const flattenedSteps = instructionSteps(recipe.recipeInstructions).map((step) => clean(step, 2_000)).filter((step): step is string => Boolean(step)).slice(0, 60);
    const instructions = flattenedSteps.length ? flattenedSteps.map((step, index) => `${index + 1}. ${step}`).join("\n") : undefined;
    const structuredRecipe: StructuredRecipe = { name, description, yieldText, ingredientLines: ingredients, instructions };
    const context = [name && `Recipe: ${name}`, yieldText && `Yield: ${yieldText}`].filter(Boolean);
    if (options.includeInstructions && description) {
      context.push(`Description: ${description}`);
    }
    const steps = options.includeInstructions ? flattenedSteps : [];
    const body = [...context, "Ingredients:", ...ingredients.map((item) => `- ${item}`)];
    if (steps.length) body.push("Instructions:", ...steps.map((step, index) => `${index + 1}. ${step}`));
    return { url, title: name ?? new URL(url).hostname, excerpt: decodeEntities(body.join("\n")), recipeFound: true, structuredRecipe };
  }

  // Navigation and promotional chrome are removed before the generic sanitizer.
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html;
  const cleaned = main.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*(?:class|id)=["'][^"']*(?:advert|cookie|newsletter|social|related)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, " ");
  const excerpt = sanitizeHtml(cleaned, 20_000);
  return { url, title: new URL(url).hostname, excerpt, recipeFound: false };
}

export async function fetchMealPage(raw: string, request?: typeof fetch, options: MealPageOptions = {}): Promise<MealPage> {
  // The shared fetcher validates the submitted destination and every redirect,
  // applies time/redirect caps and sends no ambient credentials.
  //
  // An oversized page is read up to the cap rather than rejected, as a research
  // source already was. Rejecting it made "page exceeds 512 KB" one of the most
  // common ways an import failed, on pages whose recipe was perfectly readable:
  // the cap counts decompressed bytes, which a mainstream recipe portal passes
  // on markup and inline script alone. `keepRecipeJsonLd` then covers the case
  // a bare prefix would still lose - a publisher whose Recipe JSON-LD sits after
  // all of that - so the structured data is retrieved either way.
  const page = await fetchResearchSource(raw, { fetch: request, preserveHtml: true, keepRecipeJsonLd: true });
  return extractMealPage(page.excerpt, page.url, options);
}

export function mealPagePrompt(page: MealPage, userText: string) {
  const context = userText ? `User context (authoritative; use it as an override and warn about conflicts):\n${userText}\n\n` : "";
  return `${context}${asUntrustedExcerpt(page.url, page.excerpt)}`;
}
