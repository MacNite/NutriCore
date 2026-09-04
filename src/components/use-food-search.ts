"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * One search result, as `/api/foods/search` returns it. It carries the
 * measuring rules (`basisUnit`, `densityGPerMl`, `servings`) as well as the
 * display fields, because the recipe form has to decide from them which units
 * an ingredient may use before it offers the food at all.
 */
export interface FoodSearchResult {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  sourceType: string;
  basisAmount: number;
  basisUnit: "G" | "ML";
  densityGPerMl: number | null;
  nutrients: Record<string, number | null>;
  servings: { label: string; amount: number; unit: string; gramEquivalent: number | null; mlEquivalent: number | null }[];
  favorite: boolean;
  recipeId: string | null;
}

export interface FoodSearchProviderError {
  provider: string;
  reason: "RATE_LIMITED" | "TIMEOUT" | "NETWORK" | "HTTP_ERROR" | "UNAVAILABLE";
  retryAfterSeconds?: number;
}

export interface FoodSearchOutcome {
  results: FoodSearchResult[];
  recipeDrafts: { id: string; name: string; ingredientCount: number }[];
  barcode: string | null;
  providerError: FoodSearchProviderError | null;
  suggestResearch: boolean;
}

const DEBOUNCE_MS = 500;

export const providerName = (provider: string) => (provider === "OPEN_FOOD_FACTS" ? "Open Food Facts" : provider);

export interface UseFoodSearchOptions {
  /** Ranks results towards what is usually eaten at this meal. */
  meal?: string;
  /** Whether unconfirmed AI recipe drafts are offered beside the foods. */
  drafts?: boolean;
  /**
   * Shortest query that is searched at all. Zero - the default - also asks for
   * the empty query, which answers with the recently used foods.
   */
  minQueryLength?: number;
  /** Called with every outcome a request produced, for opening a result panel. */
  onOutcome?: (outcome: FoodSearchOutcome) => void;
}

/**
 * The food search itself: debounced local lookups while typing, Open Food Facts
 * and barcodes only on request, one in-flight request at a time.
 *
 * It lives apart from any one field because every place that searches foods -
 * the food page, the diary dropdown, the recipe ingredient picker - has to
 * search the same way. A form that only queried the local store looked like the
 * others while quietly finding less.
 */
export function useFoodSearch(options: UseFoodSearchOptions = {}) {
  const { meal, drafts = false, minQueryLength = 0 } = options;
  const t = useTranslations("foods");
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<FoodSearchOutcome | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const immediateQuery = useRef<string | null>(null);
  // Held in a ref so a caller passing an inline callback does not rebuild
  // `run` - and with it restart the debounce - on every render.
  const onOutcome = useRef(options.onOutcome);
  onOutcome.current = options.onOutcome;

  const run = useCallback(
    async (value: string, remote = false) => {
      controller.current?.abort();

      const next = new AbortController();
      controller.current = next;
      setLoading(true);

      try {
        const barcode = /^\d{8}$|^\d{12,14}$/.test(value.trim());
        const params = new URLSearchParams({
          q: value,
          remote: remote || barcode ? "1" : "0",
          drafts: drafts ? "1" : "0",
        });
        if (meal) params.set("meal", meal);
        const response = await fetch(`/api/foods/search?${params}`, { signal: next.signal });
        if (!response.ok) {
          if (response.status === 429) {
            const retryAfterSeconds = Number(response.headers.get("Retry-After")) || undefined;
            setOutcome((current) => ({
              results: current?.results ?? [], recipeDrafts: current?.recipeDrafts ?? [], barcode: current?.barcode ?? null, suggestResearch: current?.suggestResearch ?? true,
              providerError: { provider: "NUTRICORE", reason: "RATE_LIMITED", retryAfterSeconds },
            }));
            return;
          }
          throw new Error(String(response.status));
        }
        const responseOutcome = (await response.json()) as FoodSearchOutcome;
        setOutcome(responseOutcome);
        onOutcome.current?.(responseOutcome);
      } catch (error) {
        // An aborted request is the normal result of typing another character.
        if ((error as Error).name !== "AbortError") {
          setOutcome({
            results: [],
            recipeDrafts: [],
            barcode: null,
            providerError: { provider: "UNKNOWN", reason: "UNAVAILABLE" },
            suggestResearch: true,
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [drafts, meal],
  );

  // Autocomplete is PostgreSQL-only: OFF is contacted by the button, or by a
  // complete barcode as one discrete remote lookup.
  useEffect(() => {
    if (immediateQuery.current === query) {
      immediateQuery.current = null;
      return;
    }
    if (query.trim().length < minQueryLength) {
      controller.current?.abort();
      setOutcome(null);
      return;
    }
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [minQueryLength, query, run]);

  useEffect(() => () => controller.current?.abort(), []);

  /** A scan is an answer, not a keystroke: it looks the product up at once. */
  const scan = useCallback(
    (barcode: string) => {
      immediateQuery.current = barcode;
      setQuery(barcode);
      void run(barcode, true);
    },
    [run],
  );

  /** The explicit "search Open Food Facts" request behind the button and Enter. */
  const searchExternal = useCallback(() => void run(query, true), [query, run]);

  const providerErrorMessage = useCallback(
    (error: FoodSearchProviderError) => {
      const provider = providerName(error.provider);
      if (error.reason === "RATE_LIMITED") return error.retryAfterSeconds
        ? t("providerRateLimitedRetry", { provider, seconds: error.retryAfterSeconds })
        : t("providerRateLimited", { provider });
      if (error.reason === "TIMEOUT") return t("providerTimeout", { provider });
      if (error.reason === "HTTP_ERROR") return t("providerHttpError", { provider });
      return t("providerUnavailable", { provider });
    },
    [t],
  );

  const status = useMemo(() => {
    if (loading) return t("searching");
    if (!outcome) return "";
    if (outcome.results.length === 0 && outcome.recipeDrafts.length === 0) {
      if (outcome.providerError) return providerErrorMessage(outcome.providerError);
      return t("noResults");
    }
    return `${outcome.results.length}`;
  }, [loading, outcome, providerErrorMessage, t]);

  return { query, setQuery, outcome, loading, status, run, scan, searchExternal, providerErrorMessage };
}
