import { Prisma, type BasisUnit, type Food, type SourceType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/units";
import { SOURCE_TRUST, completeness, rankFood, textSimilarity } from "@/lib/ranking";
import { OpenFoodFactsProvider } from "@/providers/open-food-facts";
import {
  ProviderUnavailableError,
  isBarcode,
  type NormalizedFood,
  type ProviderFailureReason,
} from "@/providers/food";
import { logger } from "@/lib/logger";
import type { Locale } from "@/i18n/locales";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILED_SEARCH_COOLDOWN_MS = 30_000;
const failedSearches = new Map<string, { until: number; error: ProviderUnavailableError }>();

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
}

const toNumber = (value: Prisma.Decimal | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

type FoodWithRelations = Food & {
  nutrients: { nutrientKey: string; value: Prisma.Decimal | null }[];
  servings: { label: string; amount: Prisma.Decimal; unit: string; gramEquivalent: Prisma.Decimal | null; mlEquivalent: Prisma.Decimal | null }[];
};

export function toFoodResult(food: FoodWithRelations, score = 0, favorite = false): FoodResult {
  return {
    id: food.id,
    name: food.name,
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
  };
}

const INCLUDE = {
  nutrients: { select: { nutrientKey: true, value: true } },
  servings: { select: { label: true, amount: true, unit: true, gramEquivalent: true, mlEquivalent: true } },
} as const;

/** A user may read public provider foods and their own; never another user's. */
export const visibleFoodWhere = (userId: string): Prisma.FoodWhereInput => ({
  OR: [{ ownerId: null }, { ownerId: userId }],
});

export async function getVisibleFood(userId: string, foodId: string) {
  const food = await prisma.food.findFirst({
    where: { id: foodId, ...visibleFoodWhere(userId) },
    include: INCLUDE,
  });
  return food ? toFoodResult(food) : null;
}

export interface SearchOptions {
  userId: string;
  query: string;
  locale: Locale;
  meal?: string;
  limit?: number;
  includeRemote?: boolean;
}

export interface SearchOutcome {
  results: FoodResult[];
  barcode: string | null;
  remoteAttempted: boolean;
  providerError: { provider: string; reason: ProviderFailureReason; retryAfterSeconds?: number } | null;
  suggestResearch: boolean;
}

interface LocalMatch {
  barcodeMatch: boolean;
  exactNameMatch: boolean;
  exactNameBrandMatch: boolean;
  textMatch: number;
  previouslyUsed: boolean;
}

/** Identity/network decisions intentionally do not depend on the display score. */
export function hasIdentityMatch(matches: LocalMatch[]): boolean {
  return matches.some((match) => match.barcodeMatch || match.exactNameMatch || match.exactNameBrandMatch);
}

export function hasStrongLocalMatch(matches: LocalMatch[]): boolean {
  return hasIdentityMatch(matches) || matches.some((match) => match.previouslyUsed && match.textMatch >= 0.75);
}

/**
 * The local-first search pipeline: barcode, then everything already stored,
 * and only then a remote provider. Remote lookups never block local results.
 */
export async function searchFoods(options: SearchOptions): Promise<SearchOutcome> {
  const { userId, locale } = options;
  const query = options.query.trim();
  const limit = options.limit ?? 25;

  const barcode = isBarcode(query) ? query : null;
  const normalized = normalizeName(query);

  const [favorites, usage, localFoods] = await Promise.all([
    prisma.favorite.findMany({ where: { userId }, select: { foodId: true } }),
    prisma.foodUsageStats.findMany({ where: { userId }, select: { foodId: true, count: true, lastUsedAt: true, usualMeals: true } }),
    query.length === 0 ? findRecentCandidates(userId, options.meal, limit) : findLocalCandidates(userId, normalized, barcode, limit),
  ]);

  const favoriteIds = new Set(favorites.map((f) => f.foodId));
  const usageById = new Map(usage.map((u) => [u.foodId, u]));

  const localMatches: LocalMatch[] = [];
  const scored = localFoods.map((food) => {
    const stats = usageById.get(food.id);
    const nutrients = Object.fromEntries(food.nutrients.map((n) => [n.nutrientKey, toNumber(n.value)]));
    const haystack = [food.name, food.brand].filter(Boolean).join(" ");
    const textMatch = query.length === 0 ? 0 : Math.max(textSimilarity(query, food.name), food.brand ? textSimilarity(query, haystack) : 0);
    const match = {
      barcodeMatch: barcode !== null && food.barcode === barcode,
      exactNameMatch: query.length > 0 && normalizeName(food.name) === normalized,
      exactNameBrandMatch: query.length > 0 && Boolean(food.brand && normalizeName(haystack) === normalized),
      textMatch,
      previouslyUsed: Boolean(stats && stats.count > 0),
    };
    localMatches.push(match);

    const score = rankFood({
      barcodeMatch: match.barcodeMatch,
      exactNameMatch: match.exactNameMatch || match.exactNameBrandMatch,
      textMatch,
      brandMatch: Boolean(food.brand && normalizeName(food.brand).includes(normalized)),
      localeMatch: food.locale === locale,
      favorite: favoriteIds.has(food.id),
      daysSinceUse: stats?.lastUsedAt ? (Date.now() - stats.lastUsedAt.getTime()) / 86_400_000 : undefined,
      usageFrequency: stats?.count ?? 0,
      sameMealContext: Boolean(options.meal && stats?.usualMeals.some((m) => m === options.meal)),
      customFood: food.ownerId !== null && food.sourceType === "USER",
      personalRecipe: food.sourceType === "RECIPE",
      dataCompleteness: completeness(nutrients),
      sourceTrust: SOURCE_TRUST[food.sourceType] ?? 0.5,
      servingAvailability: food.servingSize !== null || food.servings.length > 0,
      isAI: food.sourceType === "AI_RESEARCH",
      aiConfidence: toNumber(food.dataConfidence) ?? undefined,
    });

    return toFoodResult(food, score, favoriteIds.has(food.id));
  });

  scored.sort((a, b) => b.score - a.score);

  // Typing never reaches the provider: only an explicit request or a complete
  // barcode does, and a known local identity (including a strong previously-used
  // match) is answered from the local store instead.
  const shouldGoRemote =
    (barcode !== null || (options.includeRemote === true && query.length >= 3)) &&
    !hasStrongLocalMatch(localMatches);

  let providerError: SearchOutcome["providerError"] = null;
  let remoteAttempted = false;

  if (shouldGoRemote) {
    remoteAttempted = true;
    try {
      const remote = await fetchRemote(query, barcode, locale);
      for (const food of remote) {
        if (scored.some((r) => r.barcode && r.barcode === food.barcode)) continue;
        scored.push(food);
      }
      scored.sort((a, b) => b.score - a.score);
    } catch (error) {
      // An outage degrades the result list; it never fails the request.
      providerError =
        error instanceof ProviderUnavailableError
          ? { provider: error.provider, reason: error.reason, retryAfterSeconds: error.retryAfterSeconds }
          : { provider: "UNKNOWN", reason: "UNAVAILABLE" };
      logger.warn("Remote food provider failed", providerError);
    }
  }

  const results = scored.slice(0, limit);
  return {
    results,
    barcode,
    remoteAttempted,
    providerError,
    // AI research is offered, never triggered automatically.
    suggestResearch: results.length === 0 || results.every((r) => r.score < 300),
  };
}

async function findLocalCandidates(userId: string, normalized: string, barcode: string | null, limit: number) {
  const where: Prisma.FoodWhereInput = {
    ...visibleFoodWhere(userId),
    ...(barcode
      ? { barcode }
      : {
          OR: [
            { normalizedName: { contains: normalized } },
            { name: { contains: normalized, mode: "insensitive" } },
            { brand: { contains: normalized, mode: "insensitive" } },
            { aliases: { some: { name: { contains: normalized, mode: "insensitive" } } } },
          ],
        }),
  };

  return prisma.food.findMany({ where, include: INCLUDE, take: Math.max(limit * 4, 60) });
}

async function findRecentCandidates(userId: string, meal: string | undefined, limit: number) {
  const usage = await prisma.foodUsageStats.findMany({
    where: { userId, ...(meal ? { usualMeals: { has: meal as never } } : {}) },
    orderBy: [{ lastUsedAt: "desc" }, { count: "desc" }],
    take: Math.max(limit * 2, 25),
    select: { foodId: true },
  });
  if (usage.length === 0) return [];
  const foods = await prisma.food.findMany({
    where: { id: { in: usage.map((item) => item.foodId) }, ...visibleFoodWhere(userId) },
    include: INCLUDE,
  });
  const order = new Map(usage.map((item, index) => [item.foodId, index]));
  return foods.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
}

/**
 * Queries the cache first, then the provider, and writes what it learns back
 * into the local store so the next search is instant.
 */
export async function fetchRemote(query: string, barcode: string | null, locale: Locale): Promise<FoodResult[]> {
  const provider = new OpenFoodFactsProvider();
  if (!provider.enabled) return [];

  if (barcode) {
    const existing = await prisma.food.findFirst({
      where: { barcode, ownerId: null },
      include: INCLUDE,
    });
    if (existing) return [toFoodResult(existing, 1_000_000)];

    const product = await provider.getByBarcode(barcode);
    if (!product) return [];
    const stored = await upsertProviderFood(product, locale);
    return stored ? [stored] : [];
  }

  const cacheKey = normalizeName(query);
  const cooldown = failedSearches.get(`${provider.name}:${cacheKey}`);
  if (cooldown && cooldown.until > Date.now()) throw cooldown.error;
  if (cooldown) failedSearches.delete(`${provider.name}:${cacheKey}`);
  const cached = await prisma.searchQueryCache.findUnique({
    where: { provider_queryKey: { provider: provider.name, queryKey: cacheKey } },
  });

  let products: NormalizedFood[];
  if (cached && cached.expiresAt > new Date()) {
    products = (cached.results as unknown as NormalizedFood[]).map((p) => ({
      ...p,
      provenance: { ...p.provenance, retrievedAt: new Date(p.provenance.retrievedAt) },
    }));
  } else {
    try {
      products = await provider.search(query, { limit: 25, locale });
      failedSearches.delete(`${provider.name}:${cacheKey}`);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        const duration = Math.max(FAILED_SEARCH_COOLDOWN_MS, (error.retryAfterSeconds ?? 0) * 1000);
        failedSearches.set(`${provider.name}:${cacheKey}`, { until: Date.now() + duration, error });
      }
      throw error;
    }
    // Empty answers may be transient at OFF; leaving them uncached makes retry useful.
    if (products.length > 0) await prisma.searchQueryCache.upsert({
      where: { provider_queryKey: { provider: provider.name, queryKey: cacheKey } },
      create: {
        provider: provider.name,
        queryKey: cacheKey,
        results: products as unknown as Prisma.InputJsonValue,
        // Short-lived: enough to absorb typing, not enough to go stale.
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
      update: {
        results: products as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
  }

  const stored = await Promise.all(products.map((product) => upsertProviderFood(product, locale)));
  return stored.filter((food): food is FoodResult => food !== null);
}

/** Stores a provider product as a shared (ownerless) food with full provenance. */
export async function upsertProviderFood(product: NormalizedFood, locale: Locale): Promise<FoodResult | null> {
  const normalizedName = normalizeName(product.name);
  if (!normalizedName) return null;

  const nutrientRows = Object.entries(product.nutrients)
    .filter(([, value]) => value !== null)
    .map(([nutrientKey, value]) => ({ nutrientKey, value: value as number }));

  const data = {
    name: product.name,
    normalizedName,
    brand: product.brand ?? null,
    barcode: product.barcode ?? null,
    locale: product.locale ?? locale,
    foodType: "PACKAGED" as const,
    sourceType: "OPEN_FOOD_FACTS" as const,
    externalProvider: product.provenance.provider,
    externalId: product.externalId,
    basisAmount: product.basisAmount,
    basisUnit: product.basisUnit,
    servingSize: product.servingAmount ?? null,
    servingUnit: product.servingUnit ?? null,
    dataConfidence: product.provenance.confidence ?? null,
    isEstimated: product.provenance.estimated,
  };

  // Prefer the provider identity, then reuse an ownerless row with the same
  // barcode. This keeps diary foreign keys stable if OFF exposes the same
  // product through a refreshed external identifier.
  const providerIdentity = await prisma.food.findUnique({
    where: { externalProvider_externalId: { externalProvider: product.provenance.provider, externalId: product.externalId } },
    select: { id: true },
  });
  const barcodeIdentity = !providerIdentity && product.barcode
    ? await prisma.food.findFirst({ where: { barcode: product.barcode, ownerId: null }, select: { id: true } })
    : null;
  const identity = providerIdentity ?? barcodeIdentity;
  const food = identity
    ? await prisma.food.update({ where: { id: identity.id }, data, include: INCLUDE })
    : await prisma.food.create({ data: { ...data, ownerId: null }, include: INCLUDE });

  await prisma.$transaction([
    prisma.foodNutrient.deleteMany({ where: { foodId: food.id } }),
    prisma.foodNutrient.createMany({
      data: nutrientRows.map((row) => ({ foodId: food.id, ...row })),
      skipDuplicates: true,
    }),
    prisma.foodServing.deleteMany({ where: { foodId: food.id } }),
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
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
        normalized: product as unknown as Prisma.InputJsonValue,
      },
      update: {
        retrievedAt: product.provenance.retrievedAt,
        providerUpdatedAt: product.provenance.providerUpdatedAt ?? null,
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
        normalized: product as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);

  const refreshed = await prisma.food.findUniqueOrThrow({ where: { id: food.id }, include: INCLUDE });
  return toFoodResult(refreshed, 400);
}
