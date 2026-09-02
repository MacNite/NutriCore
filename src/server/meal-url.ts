import { asUntrustedExcerpt, sanitizeHtml } from "@/lib/url-guard";
import { fetchResearchSource } from "./research";

export type MealPage = { url: string; title: string; excerpt: string; recipeFound: boolean };

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
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { recipes.push(...recipeObjects(JSON.parse(match[1]))); } catch { /* malformed publisher data is ignored */ }
  }
  const recipe = recipes.find((item) => Array.isArray(item.recipeIngredient) && item.recipeIngredient.length);
  if (recipe) {
    const ingredients = (recipe.recipeIngredient as unknown[]).filter((item): item is string => typeof item === "string").slice(0, 80);
    const context = [recipe.name && `Recipe: ${String(recipe.name)}`, recipe.recipeYield && `Yield: ${String(recipe.recipeYield)}`].filter(Boolean);
    if (options.includeInstructions && typeof recipe.description === "string" && recipe.description.trim()) {
      context.push(`Description: ${recipe.description}`);
    }
    const steps = options.includeInstructions ? instructionSteps(recipe.recipeInstructions).slice(0, 60) : [];
    const body = [...context, "Ingredients:", ...ingredients.map((item) => `- ${item}`)];
    if (steps.length) body.push("Instructions:", ...steps.map((step, index) => `${index + 1}. ${step}`));
    return { url, title: String(recipe.name ?? new URL(url).hostname).slice(0, 300), excerpt: decodeEntities(body.join("\n")), recipeFound: true };
  }

  // Navigation and promotional chrome are removed before the generic sanitizer.
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html;
  const cleaned = main.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*(?:class|id)=["'][^"']*(?:advert|cookie|newsletter|social|related)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, " ");
  const excerpt = sanitizeHtml(cleaned, 20_000);
  return { url, title: new URL(url).hostname, excerpt, recipeFound: false };
}

export async function fetchMealPage(raw: string, request?: typeof fetch, options: MealPageOptions = {}): Promise<MealPage> {
  // The shared fetcher validates the submitted destination and every redirect,
  // applies time/redirect caps, sends no ambient credentials, and rejects the
  // response instead of retaining a partial oversized recipe.
  const page = await fetchResearchSource(raw, { strictSize: true, fetch: request, preserveHtml: true });
  return extractMealPage(page.excerpt, page.url, options);
}

export function mealPagePrompt(page: MealPage, userText: string) {
  const context = userText ? `User context (authoritative; use it as an override and warn about conflicts):\n${userText}\n\n` : "";
  return `${context}${asUntrustedExcerpt(page.url, page.excerpt)}`;
}
