import { Prisma, type BasisUnit, type Food, type Locale as PrismaLocale, type SourceType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeName, type PortionContext } from "@/lib/units";
import { effectiveDensity } from "@/lib/density";
import { hasUsableEnergy } from "@/lib/nutrients";
import { SOURCE_TRUST, completeness, rankFood, textSimilarity } from "@/lib/ranking";
import { OpenFoodFactsProvider } from "@/providers/open-food-facts";
import { UsdaProvider } from "@/providers/usda";
import { FatSecretProvider } from "@/providers/fatsecret";
import {
  ProviderUnavailableError,
  isBarcode,
  type FoodProvider,
  type NormalizedFood,
  type ProviderFailureReason,
} from "@/providers/food";
import {
  BUNDLED_SOURCE_TYPES,
  FOOD_SOURCES,
  barcodeTiers,
  cacheExpiryFor,
  textSearchTiers,
  type FoodSourceDescriptor,
} from "@/providers/food-sources";
import { isSufficient, type CandidateSignals, type TierReport } from "./food-search-policy";
import { logger } from "@/lib/logger";
import type { Locale } from "@/i18n/locales";

const FAILED_SEARCH_COOLDOWN_MS = 30_000;
const failedSearches = new Map<string, { until: number; error: ProviderUnavailableError }>();

/**
 * Forgets the per-query provider cooldowns.
 *
 * They live in module scope on purpose - a provider instance is created per
 * request - which makes them survive between tests in the same file and turn
 * one deliberate outage into an unexplained one three tests later.
 */
export function resetFoodSearchCooldowns() {
  failedSearches.clear();
}

/**
 * The measuring rules for one stored food, as `resolvePortion` and
 * `allowedUnits` need them. Kept in one place because the recipe save, the AI
 * import and the recipe form all have to agree on which units a food accepts.
 *
 * A food sold by volume that stores no density gets an assumed one, because
 * Open Food Facts publishes none and a recipe ingredient has to end up with a
 * weight: without it every drink, oil and broth was unusable in a recipe, which
 * failed the whole AI import rather than the one ingredient. The assumption is
 * made only for a volume basis - a solid's density is not near water's and is
 * never guessed - and is flagged so callers can mark the weights it produced.
 */
export function foodPortionContext(food: {
  name: string;
  basisUnit: BasisUnit;
  densityGPerMl: Prisma.Decimal | null;
  servings: { label: string; unit: string; amount: Prisma.Decimal; gramEquivalent: Prisma.Decimal | null; mlEquivalent: Prisma.Decimal | null }[];
}): PortionContext {
  return {
    basisUnit: food.basisUnit,
    ...effectiveDensity({ name: food.name, basisUnit: food.basisUnit, densityGPerMl: toNumber(food.densityGPerMl) }),
    servings: food.servings.map((serving) => ({
      label: serving.label,
      unit: serving.unit,
      amount: Number(serving.amount),
      gramEquivalent: toNumber(serving.gramEquivalent),
      mlEquivalent: toNumber(serving.mlEquivalent),
    })),
  };
}

export interface FoodResult {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  sourceType: SourceType;
  basisAmount: number;
  basisUnit: BasisUnit;
  servingSize: number | null;
  servingUnit: string | null;
  densityGPerMl: number | null;
  isEstimated: boolean;
  nutrients: Record<string, number | null>;
  servings: { label: string; amount: number; unit: string; gramEquivalent: number | null; mlEquivalent: number | null }[];
  favorite: boolean;
  score: number;
  recipeId: string | null;
}

const toNumber = (value: Prisma.Decimal | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

type FoodWithRelations = Food & {
  nutrients: { nutrientKey: string; value: Prisma.Decimal | null }[];
  servings: { label: string; amount: Prisma.Decimal; unit: string; gramEquivalent: Prisma.Decimal | null; mlEquivalent: Prisma.Decimal | null }[];
  translations?: { locale: PrismaLocale; name: string; normalizedName: string }[];
  aliases?: { name: string; locale: PrismaLocale | null }[];
};

/**
 * The name to show, in the reader's language where the source published one.
 *
 * BLS ships an official English name for all 7,140 of its foods, so an
 * English-speaking user has no reason to read German. Nothing is translated
 * here - only an official name from the source is ever used - which is why a
 * branded product keeps the name it is sold under.
 */
export function displayName(food: Pick<FoodWithRelations, "name" | "translations">, locale?: Locale): string {
  if (!locale) return food.name;
  return food.translations?.find((translation) => translation.locale === locale)?.name ?? food.name;
}

export function toFoodResult(food: FoodWithRelations, score = 0, favorite = false, locale?: Locale): FoodResult {
  return {
    id: food.id,
    name: displayName(food, locale),
    brand: food.brand,
    barcode: food.barcode,
    sourceType: food.sourceType,
    basisAmount: Number(food.basisAmount),
    basisUnit: food.basisUnit,
    servingSize: toNumber(food.servingSize),
    servingUnit: food.servingUnit,
    densityGPerMl: toNumber(food.densityGPerMl),
    isEstimated: food.isEstimated,
    nutrients: Object.fromEntries(food.nutrients.map((n) => [n.nutrientKey, toNumber(n.value)])),
    servings: food.servings.map((s) => ({
      label: s.label,
      amount: Number(s.amount),
      unit: s.unit,
      gramEquivalent: toNumber(s.gramEquivalent),
      mlEquivalent: toNumber(s.mlEquivalent),
    })),
    favorite,
    score,
    recipeId: food.sourceType === "RECIPE" && food.externalProvider === "NUTRICORE_RECIPE" ? food.externalId : null,
  };
}

const INCLUDE = {
  nutrients: { select: { nutrientKey: true, value: true } },
  servings: { select: { label: true, amount: true, unit: true, gramEquivalent: true, mlEquivalent: true } },
  // Both are needed while ranking, not merely while rendering: an exact match
  // on an official translation or on a synonym is an identity match, and it is
  // what lets a German food be found by its English name.
  translations: { select: { locale: true, name: true, normalizedName: true } },
  aliases: { select: { name: true, locale: true } },
} as const;

/** A user may read public provider foods and their own; never another user's. */
export const visibleFoodWhere = (userId: string): Prisma.FoodWhereInput => ({
  OR: [{ ownerId: null }, { ownerId: userId }],
});

export async function getVisibleFood(userId: string, foodId: string, locale?: Locale) {
  const food = await prisma.food.findFirst({
    where: { id: foodId, ...visibleFoodWhere(userId) },
    include: INCLUDE,
  });
  return food ? toFoodResult(food, 0, false, locale) : null;
}

export interface SearchOptions {
  userId: string;
  query: string;
  locale: Locale;
  meal?: string;
  limit?: number;
  includeRemote?: boolean;
  includeRecipeDrafts?: boolean;
}

export interface RecipeDraftResult {
  id: string;
  name: string;
  ingredientCount: number;
}

export interface SearchOutcome {
  results: FoodResult[];
  recipeDrafts: RecipeDraftResult[];
  barcode: string | null;
  remoteAttempted: boolean;
  providerError: { provider: string; reason: ProviderFailureReason; retryAfterSeconds?: number } | null;
  suggestResearch: boolean;
  /** Which sources were consulted, in tier order. Diagnostics, and testable. */
  tiers: TierReport[];
}

interface LocalMatch {
  barcodeMatch: boolean;
  exactNameMatch: boolean;
  exactNameBrandMatch: boolean;
  /** An exact match on a synonym or an official translation of the name. */
  exactAliasMatch?: boolean;
  textMatch: number;
  previouslyUsed: boolean;
}

/** Identity/network decisions intentionally do not depend on the display score. */
export function hasIdentityMatch(matches: LocalMatch[]): boolean {
  return matches.some(
    (match) => match.barcodeMatch || match.exactNameMatch || match.exactNameBrandMatch || match.exactAliasMatch === true,
  );
}

export function hasStrongLocalMatch(matches: LocalMatch[]): boolean {
  return hasIdentityMatch(matches) || matches.some((match) => match.previouslyUsed && match.textMatch >= 0.75);
}

/** The network adapter for a source, or null for a purely local one. */
export function providerFor(source: FoodSourceDescriptor): FoodProvider | null {
  switch (source.id) {
    case "OPEN_FOOD_FACTS":
      return new OpenFoodFactsProvider();
    case "USDA":
      return new UsdaProvider();
    case "FATSECRET":
      return new FatSecretProvider();
    default:
      return null;
  }
}

/**
 * The stored rows a source owns, as a `where` fragment.
 *
 * "Local" is the user's own foods, their recipes as foods, and the public
 * foods NutriCore already holds - including a food from a bundled database
 * that this user has eaten or favourited before. That last part matters: an
 * English-locale search does not trawl BLS, but a German food somebody has
 * already logged must keep being findable, under its English name, rather than
 * disappearing because of the language they read the app in.
 */
function storedScope(source: FoodSourceDescriptor, familiarIds: string[]): Prisma.FoodWhereInput | null {
  if (!source.stored) return null;
  if ("rest" in source.stored) {
    const notBundled: Prisma.FoodWhereInput = { NOT: { sourceType: { in: BUNDLED_SOURCE_TYPES as SourceType[] } } };
    return familiarIds.length > 0 ? { OR: [notBundled, { id: { in: familiarIds } }] } : notBundled;
  }
  return { sourceType: { in: source.stored.sourceTypes as SourceType[] } };
}

/**
 * The local-first, tiered search pipeline.
 *
 * Sources are consulted strictly in the order `src/providers/food-sources.ts`
 * gives for this locale, and the walk stops as soon as what has been found is
 * good enough (`src/server/food-search-policy.ts`). That is what keeps a
 * German search for a generic food off the network entirely: the user's own
 * foods and BLS both answer from PostgreSQL.
 *
 * Nothing found by an earlier tier is discarded when a later one is consulted -
 * every candidate is ranked together at the end - so tiering reduces requests
 * without hiding alternatives.
 */
export async function searchFoods(options: SearchOptions): Promise<SearchOutcome> {
  const { userId, locale } = options;
  const query = options.query.trim();
  const limit = options.limit ?? 25;

  const barcode = isBarcode(query) ? query : null;
  const normalized = normalizeName(query);

  const [favorites, usage, recipeDrafts] = await Promise.all([
    prisma.favorite.findMany({ where: { userId }, select: { foodId: true } }),
    prisma.foodUsageStats.findMany({ where: { userId }, select: { foodId: true, count: true, lastUsedAt: true, usualMeals: true } }),
    options.includeRecipeDrafts && query.length > 0
      ? prisma.recipe.findMany({
          where: { ownerId: userId, status: "DRAFT", name: { contains: query, mode: "insensitive" } },
          orderBy: { updatedAt: "desc" },
          take: 5,
          select: { id: true, name: true, _count: { select: { ingredients: true } } },
        })
      : Promise.resolve([]),
  ]);

  const favoriteIds = new Set(favorites.map((f) => f.foodId));
  const usageById = new Map(usage.map((u) => [u.foodId, u]));
  // The foods this user has a relationship with, whichever database they came
  // from. See `storedScope`.
  const familiarIds = [...new Set([...favoriteIds, ...usageById.keys()])];

  const scored: FoodResult[] = [];
  const seenIds = new Set<string>();
  const signals: CandidateSignals[] = [];
  const tiers: TierReport[] = [];

  /**
   * Scores one stored row and keeps it, unless it is already in the list.
   * Returns the signals it contributed, so the tier walk can decide whether to
   * carry on.
   */
  const collectStored = (food: FoodWithRelations): CandidateSignals | null => {
    if (seenIds.has(food.id)) return null;
    const nutrients = Object.fromEntries(food.nutrients.map((n) => [n.nutrientKey, toNumber(n.value)]));
    // A food that states no energy is dropped before it is ever scored, so it
    // can neither be shown nor count as the match that would stop a later tier
    // from finding a complete version of the same food.
    if (!hasUsableEnergy(nutrients)) return null;
    seenIds.add(food.id);

    const stats = usageById.get(food.id);
    const shown = displayName(food, locale);
    const haystack = [shown, food.brand].filter(Boolean).join(" ");
    const names = [food.name, shown, ...(food.translations ?? []).map((t) => t.name)];
    const textMatch =
      query.length === 0
        ? 0
        : Math.max(
            ...names.map((name) => textSimilarity(query, name)),
            food.brand ? textSimilarity(query, haystack) : 0,
          );

    const exactAliasMatch =
      query.length > 0 &&
      [...(food.aliases ?? []).map((alias) => alias.name), ...(food.translations ?? []).map((t) => t.name)].some(
        (name) => normalizeName(name) === normalized,
      );

    const match: LocalMatch = {
      barcodeMatch: barcode !== null && food.barcode === barcode,
      exactNameMatch: query.length > 0 && normalizeName(food.name) === normalized,
      exactNameBrandMatch: query.length > 0 && Boolean(food.brand && normalizeName(haystack) === normalized),
      exactAliasMatch,
      textMatch,
      previouslyUsed: Boolean(stats && stats.count > 0),
    };

    const dataCompleteness = completeness(nutrients);
    const score = rankFood({
      barcodeMatch: match.barcodeMatch,
      exactNameMatch: match.exactNameMatch || match.exactNameBrandMatch || exactAliasMatch,
      textMatch,
      brandMatch: Boolean(food.brand && normalizeName(food.brand).includes(normalized)),
      localeMatch: food.locale === locale || (food.translations ?? []).some((t) => t.locale === locale),
      favorite: favoriteIds.has(food.id),
      daysSinceUse: stats?.lastUsedAt ? (Date.now() - stats.lastUsedAt.getTime()) / 86_400_000 : undefined,
      usageFrequency: stats?.count ?? 0,
      sameMealContext: Boolean(options.meal && stats?.usualMeals.some((m) => m === options.meal)),
      customFood: food.ownerId !== null && food.sourceType === "USER",
      personalRecipe: food.sourceType === "RECIPE",
      dataCompleteness,
      sourceTrust: SOURCE_TRUST[food.sourceType] ?? 0.5,
      servingAvailability: food.servingSize !== null || food.servings.length > 0,
      isAI: food.sourceType === "AI_RESEARCH",
      aiConfidence: toNumber(food.dataConfidence) ?? undefined,
    });

    scored.push(toFoodResult(food, score, favoriteIds.has(food.id), locale));
    return { strongMatch: hasStrongLocalMatch([match]), completeness: dataCompleteness };
  };

  // Typing never reaches a network provider: only an explicit request or a
  // complete barcode does. A stored tier - the user's own foods, BLS, the
  // imported USDA releases - costs one indexed query and always runs.
  const remotePermitted = barcode !== null || (options.includeRemote === true && query.length >= 3);
  const order = barcode ? barcodeTiers() : textSearchTiers(locale);

  let providerError: SearchOutcome["providerError"] = null;
  let remoteAttempted = false;
  let stopped = false;

  for (const source of order) {
    const report: TierReport = { source: source.id, stored: 0, remote: 0, skipped: null, failed: false };
    tiers.push(report);

    if (stopped) {
      report.skipped = "sufficient-result";
      continue;
    }

    const scope = storedScope(source, familiarIds);
    if (scope) {
      const rows =
        query.length === 0
          ? await findRecentCandidates(userId, options.meal, limit, scope)
          : await findStoredCandidates(userId, normalized, barcode, limit, scope);
      for (const row of rows) {
        const candidate = collectStored(row);
        if (candidate) {
          signals.push(candidate);
          report.stored += 1;
        }
      }
      if (isSufficient(signals)) {
        stopped = true;
        continue;
      }
    }

    if (!source.network) continue;

    if (!remotePermitted) {
      report.skipped = "remote-not-requested";
      continue;
    }
    if (!source.isNetworkConfigured()) {
      report.skipped = "not-configured";
      continue;
    }

    remoteAttempted = true;
    try {
      const remote = await fetchRemote(query, barcode, locale, source);
      for (const food of remote) {
        if (!hasUsableEnergy(food.nutrients)) continue;
        if (seenIds.has(food.id)) continue;
        // Two providers describing the same barcode are the same product.
        if (food.barcode && scored.some((r) => r.barcode && r.barcode === food.barcode)) continue;
        seenIds.add(food.id);
        scored.push(food);
        report.remote += 1;
        signals.push({
          strongMatch:
            (barcode !== null && food.barcode === barcode) ||
            (query.length > 0 && normalizeName(food.name) === normalized),
          completeness: completeness(food.nutrients),
        });
      }
      if (isSufficient(signals)) stopped = true;
    } catch (error) {
      // One unavailable source must never stop the ones after it, and must
      // never fail the request: the tiers already consulted keep their results.
      report.failed = true;
      const failure =
        error instanceof ProviderUnavailableError
          ? { provider: error.provider, reason: error.reason, retryAfterSeconds: error.retryAfterSeconds }
          : { provider: source.id, reason: "UNAVAILABLE" as ProviderFailureReason };
      providerError ??= failure;
      logger.warn("Food source failed; continuing with the next tier", failure);
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, limit);

  return {
    results,
    recipeDrafts: recipeDrafts.map((recipe) => ({ id: recipe.id, name: recipe.name, ingredientCount: recipe._count.ingredients })),
    barcode,
    remoteAttempted,
    providerError,
    // AI research is offered, never triggered automatically.
    suggestResearch: results.length === 0 || results.every((r) => r.score < 300),
    tiers,
  };
}

async function findStoredCandidates(
  userId: string,
  normalized: string,
  barcode: string | null,
  limit: number,
  scope: Prisma.FoodWhereInput,
) {
  // The conditions are held in an AND: the text match is itself an OR, and
  // spreading it beside the visibility OR would silently replace it and expose
  // every other user's private foods.
  const where: Prisma.FoodWhereInput = {
    AND: [
      visibleFoodWhere(userId),
      barcode
        ? { barcode }
        : {
            OR: [
              { normalizedName: { contains: normalized } },
              { name: { contains: normalized, mode: "insensitive" } },
              { brand: { contains: normalized, mode: "insensitive" } },
              { aliases: { some: { name: { contains: normalized, mode: "insensitive" } } } },
              { translations: { some: { normalizedName: { contains: normalized } } } },
            ],
          },
      scope,
    ],
  };

  return prisma.food.findMany({ where, include: INCLUDE, take: Math.max(limit * 4, 60) });
}

async function findRecentCandidates(userId: string, meal: string | undefined, limit: number, scope: Prisma.FoodWhereInput) {
  const usage = await prisma.foodUsageStats.findMany({
    where: { userId, ...(meal ? { usualMeals: { has: meal as never } } : {}) },
    orderBy: [{ lastUsedAt: "desc" }, { count: "desc" }],
    take: Math.max(limit * 2, 25),
    select: { foodId: true },
  });
  if (usage.length === 0) return [];
  const foods = await prisma.food.findMany({
    where: { id: { in: usage.map((item) => item.foodId) }, ...visibleFoodWhere(userId), AND: [scope] },
    include: INCLUDE,
  });
  const order = new Map(usage.map((item, index) => [item.foodId, index]));
  return foods.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
}

/**
 * Queries one network source: its cache first, then the provider, and writes
 * what it learns back into the local store so the next search is instant.
 *
 * The TTLs, and whether an expired answer may be served during an outage, come
 * from the source's own cache policy rather than from a constant here. Open
 * Food Facts publishes an open database, so yesterday's answer beats an error
 * message; FatSecret's terms allow a live cache and nothing more, so an
 * expired FatSecret answer is not served at all.
 */
export async function fetchRemote(
  query: string,
  barcode: string | null,
  locale: Locale,
  source: FoodSourceDescriptor = FOOD_SOURCES.OPEN_FOOD_FACTS,
): Promise<FoodResult[]> {
  const provider = providerFor(source);
  if (!provider || !provider.enabled) return [];

  if (barcode) {
    if (!source.capabilities.barcode) return [];
    // Already stored for this barcode: answer from the local row rather than
    // spending a request on a product NutriCore already has.
    const existing = await prisma.food.findFirst({
      where: { barcode, ownerId: null },
      include: INCLUDE,
    });
    if (existing) return [toFoodResult(existing, 1_000_000, false, locale)];

    const product = await provider.getByBarcode(barcode);
    if (!product) return [];
    const stored = await upsertProviderFood(product, locale, source);
    return stored ? [stored] : [];
  }

  const cacheKey = normalizeName(query);
  const cacheWhere = { provider_queryKey: { provider: provider.name, queryKey: cacheKey } };
  const cached = await prisma.searchQueryCache.findUnique({ where: cacheWhere });
  const decode = (row: NonNullable<typeof cached>) =>
    (row.results as unknown as NormalizedFood[]).map((p) => ({
      ...p,
      provenance: { ...p.provenance, retrievedAt: new Date(p.provenance.retrievedAt) },
    }));

  let products: NormalizedFood[];
  if (cached && cached.expiresAt > new Date()) {
    products = decode(cached);
  } else {
    const cooldownKey = `${provider.name}:${cacheKey}`;
    const cooldown = failedSearches.get(cooldownKey);
    const cooling = cooldown && cooldown.until > Date.now() ? cooldown.error : null;
    if (cooldown && !cooling) failedSearches.delete(cooldownKey);

    try {
      if (cooling) throw cooling;
      products = await provider.search(query, { limit: 25, locale });
      failedSearches.delete(cooldownKey);

      // Empty answers may be transient, so leaving them uncached makes a retry
      // useful.
      if (products.length > 0) {
        const expiresAt = new Date(Date.now() + source.cache.searchTtlMs);
        const results = products as unknown as Prisma.InputJsonValue;
        await prisma.searchQueryCache.upsert({
          where: cacheWhere,
          create: { provider: provider.name, queryKey: cacheKey, results, expiresAt },
          update: { results, expiresAt },
        });
      }
    } catch (error) {
      if (error instanceof ProviderUnavailableError && !cooling) {
        const duration = Math.max(FAILED_SEARCH_COOLDOWN_MS, (error.retryAfterSeconds ?? 0) * 1000);
        failedSearches.set(cooldownKey, { until: Date.now() + duration, error });
      }
      // An expired answer beats an error message, where the source's terms let
      // it be kept: the data was correct yesterday and the user gets a usable
      // result list instead of a banner.
      if (!cached || !source.cache.serveStaleOnOutage) throw error;
      logger.info("Serving a stale provider search result", {
        provider: provider.name,
        expiredAt: cached.expiresAt,
        reason: error instanceof ProviderUnavailableError ? error.reason : "UNKNOWN",
      });
      products = decode(cached);
    }
  }

  const stored = await Promise.all(products.map((product) => upsertProviderFood(product, locale, source)));
  return stored.filter((food): food is FoodResult => food !== null);
}

/**
 * Stores a provider product as a shared (ownerless) food with full provenance.
 *
 * How long it may be kept is the source's decision, not this function's: a
 * permanent source writes a row with no expiry, a cache-limited one stamps
 * `cacheExpiresAt` so `pruneExpiredProviderFoods` can remove it again once
 * nothing references it.
 */
export async function upsertProviderFood(
  product: NormalizedFood,
  locale: Locale,
  source: FoodSourceDescriptor = FOOD_SOURCES.OPEN_FOOD_FACTS,
): Promise<FoodResult | null> {
  const normalizedName = normalizeName(product.name);
  if (!normalizedName) return null;

  if (source.cache.persistence === "REFERENCE_ONLY") {
    // Declared by the policy for a source whose terms forbid storing values at
    // all. No shipped source uses it, and honouring it needs a transient
    // result path the UI does not have - so it fails loudly rather than
    // quietly storing data it must not.
    throw new Error(`${source.id} is REFERENCE_ONLY and its content must not be stored`);
  }

  const nutrientRows = Object.entries(product.nutrients)
    .filter(([, value]) => value !== null)
    .map(([nutrientKey, value]) => ({ nutrientKey, value: value as number }));

  const base = {
    name: product.name,
    normalizedName,
    brand: product.brand ?? null,
    barcode: product.barcode ?? null,
    locale: product.locale ?? locale,
    // A generic ingredient database is not selling packaged products; storing
    // its foods as PACKAGED would be wrong everywhere that reads the type.
    foodType: product.foodType ?? ("PACKAGED" as const),
    sourceType: source.id as SourceType,
    externalProvider: product.provenance.provider,
    externalId: product.externalId,
    basisAmount: product.basisAmount,
    basisUnit: product.basisUnit,
    servingSize: product.servingAmount ?? null,
    servingUnit: product.servingUnit ?? null,
    // Omitted rather than nulled when the source states none, so a refresh that
    // drops the paired serving cannot take a density away that was read before.
    ...(product.densityGPerMl ? { densityGPerMl: product.densityGPerMl } : {}),
    dataConfidence: product.provenance.confidence ?? null,
    isEstimated: product.provenance.estimated,
    cacheExpiresAt: cacheExpiryFor(source),
  };

  // A partial source may simply not carry a field. Writing its absence as null
  // would drop detail an earlier, fuller lookup had already recorded, so on an
  // update an unknown value is omitted rather than written as empty. A create
  // has nothing to lose and stores the row as it came.
  const update = product.partial
    ? (Object.fromEntries(Object.entries(base).filter(([, value]) => value !== null)) as Partial<typeof base>)
    : base;

  // Prefer the provider identity, then reuse an ownerless row with the same
  // barcode. This keeps diary foreign keys stable if the provider exposes the
  // same product through a refreshed external identifier.
  const providerIdentity = await prisma.food.findUnique({
    where: { externalProvider_externalId: { externalProvider: product.provenance.provider, externalId: product.externalId } },
    select: { id: true },
  });
  const barcodeIdentity = !providerIdentity && product.barcode
    ? await prisma.food.findFirst({ where: { barcode: product.barcode, ownerId: null }, select: { id: true } })
    : null;
  const identity = providerIdentity ?? barcodeIdentity;
  const food = identity
    ? await prisma.food.update({ where: { id: identity.id }, data: update, include: INCLUDE })
    : await prisma.food.create({ data: { ...base, ownerId: null }, include: INCLUDE });

  // A partial source knows about some nutrients, not all of them: it replaces
  // the values it carries and leaves the rest alone. Replacing wholesale would
  // let a search hit, which knows only macronutrients, erase the vitamins a
  // barcode lookup had already established for the same product.
  const nutrientScope = product.partial
    ? { foodId: food.id, nutrientKey: { in: nutrientRows.map((row) => row.nutrientKey) } }
    : { foodId: food.id };
  // The same applies to servings: keep the known one rather than drop it.
  const replaceServings = Boolean(product.servingAmount && product.servingUnit) || !product.partial;

  await prisma.$transaction([
    prisma.foodNutrient.deleteMany({ where: nutrientScope }),
    prisma.foodNutrient.createMany({
      data: nutrientRows.map((row) => ({ foodId: food.id, ...row })),
      skipDuplicates: true,
    }),
    ...(replaceServings ? [prisma.foodServing.deleteMany({ where: { foodId: food.id } })] : []),
    ...(product.servingAmount && product.servingUnit
      ? [prisma.foodServing.create({
          data: {
            foodId: food.id,
            label: product.servingLabel ?? `${product.servingAmount} ${product.servingUnit}`,
            amount: product.servingAmount,
            unit: product.servingUnit,
            gramEquivalent: product.basisUnit === "G" ? product.servingAmount : null,
            mlEquivalent: product.basisUnit === "ML" ? product.servingAmount : null,
            isDefault: true,
          },
        })]
      : []),
    prisma.foodSource.deleteMany({ where: { foodId: food.id, provider: product.provenance.provider } }),
    prisma.foodSource.create({
      data: {
        foodId: food.id,
        provider: product.provenance.provider,
        providerId: product.provenance.providerId ?? product.externalId,
        retrievedAt: product.provenance.retrievedAt,
        providerUpdatedAt: product.provenance.providerUpdatedAt ?? null,
        url: product.provenance.url ?? null,
        confidence: product.provenance.confidence ?? null,
        estimated: product.provenance.estimated,
        metadata: (product.raw ?? {}) as Prisma.InputJsonValue,
      },
    }),
    prisma.externalFoodCache.upsert({
      where: { provider_externalId: { provider: product.provenance.provider, externalId: product.externalId } },
      create: {
        provider: product.provenance.provider,
        externalId: product.externalId,
        barcode: product.barcode ?? null,
        normalizedName,
        brand: product.brand ?? null,
        locale: product.locale ?? locale,
        retrievedAt: product.provenance.retrievedAt,
        providerUpdatedAt: product.provenance.providerUpdatedAt ?? null,
        expiresAt: new Date(Date.now() + source.cache.contentTtlMs),
        normalized: product as unknown as Prisma.InputJsonValue,
      },
      update: {
        retrievedAt: product.provenance.retrievedAt,
        providerUpdatedAt: product.provenance.providerUpdatedAt ?? null,
        expiresAt: new Date(Date.now() + source.cache.contentTtlMs),
        normalized: product as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);

  const refreshed = await prisma.food.findUniqueOrThrow({ where: { id: food.id }, include: INCLUDE });
  return toFoodResult(refreshed, 400, false, locale);
}

/**
 * Removes the foods a cache-limited source supplied once they have expired.
 *
 * This is the other half of `CACHE_WITH_TTL`: without it, "cached" would just
 * mean "stored with a date on it". A food still referenced by a diary entry, a
 * favourite or a recipe is kept - the reference is the user's, not the
 * provider's - and a diary entry keeps its own frozen nutrition anyway, so a
 * pruned food never changes a logged meal.
 */
export async function pruneExpiredProviderFoods(now = new Date()): Promise<number> {
  const { count } = await prisma.food.deleteMany({
    where: {
      cacheExpiresAt: { lt: now },
      diaryEntries: { none: {} },
      favorites: { none: {} },
      recipeIngredients: { none: {} },
    },
  });
  if (count > 0) logger.info("Pruned expired provider foods", { count });
  return count;
}
