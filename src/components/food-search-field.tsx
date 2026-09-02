"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SourceBadge } from "@/components/source-badge";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { formatKcal, formatNumber } from "@/lib/format";
import type { Locale } from "@/i18n/locales";

interface Result {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  sourceType: string;
  basisAmount: number;
  basisUnit: string;
  nutrients: Record<string, number | null>;
  favorite: boolean;
  recipeId: string | null;
}

interface Outcome {
  results: Result[];
  recipeDrafts: { id: string; name: string; ingredientCount: number }[];
  barcode: string | null;
  providerError: {
    provider: string;
    reason: "RATE_LIMITED" | "TIMEOUT" | "NETWORK" | "HTTP_ERROR" | "UNAVAILABLE";
    retryAfterSeconds?: number;
  } | null;
  suggestResearch: boolean;
}

const DEBOUNCE_MS = 500;

const providerName = (provider: string) => (provider === "OPEN_FOOD_FACTS" ? "Open Food Facts" : provider);

export interface FoodSearchFieldProps {
  meal: string; date: string; locale: Locale; autoFocus?: boolean; researchAvailable: boolean;
  researchUnavailableReason?: "SERVER_DISABLED" | "AI_DISABLED"; editMeal?: string; variant: "page" | "dropdown";
}

export function FoodSearchField({
  meal,
  date,
  locale,
  autoFocus,
  researchAvailable,
  researchUnavailableReason,
  editMeal,
  variant,
}: FoodSearchFieldProps) {
  const t = useTranslations("foods");
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState(false);
  const uid = useId().replace(/:/g, "");
  const statusId = `${uid}-status`;
  const listboxId = `${uid}-listbox`;
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const controller = useRef<AbortController | null>(null);
  const immediateQuery = useRef<string | null>(null);

  const run = useCallback(
    async (value: string, remote = false) => {
      controller.current?.abort();

      const next = new AbortController();
      controller.current = next;
      setLoading(true);

      try {
        const barcode = /^\d{8}$|^\d{12,14}$/.test(value.trim());
        const params = new URLSearchParams({ q: value, meal, remote: remote || barcode ? "1" : "0", drafts: "1" });
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
        const responseOutcome = (await response.json()) as Outcome;
        setOutcome(responseOutcome);
        if (variant === "dropdown") setOpen(true);
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
    [meal, variant],
  );

  // Autocomplete is PostgreSQL-only: OFF is contacted by the button, or by a
  // complete barcode as one discrete remote lookup.
  useEffect(() => {
    if (immediateQuery.current === query) {
      immediateQuery.current = null;
      return;
    }
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  useEffect(() => () => controller.current?.abort(), []);

  const providerErrorMessage = useCallback(
    (error: NonNullable<Outcome["providerError"]>) => {
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

  const selectable = [...(outcome?.results ?? []), ...(outcome?.recipeDrafts ?? [])];
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const resultHref = (result: Result) => `/foods/${result.id}?meal=${meal}&date=${date}${editMeal ? `&editMeal=${editMeal}` : ""}`;

  if (variant === "dropdown") {
    const showPanel = open && query.trim().length > 0 && (loading || outcome !== null);
    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape" && showPanel) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setOpen(true);
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => Math.max(0, Math.min(selectable.length - 1, current + direction)));
      } else if (event.key === "Enter" && activeIndex >= 0) {
        event.preventDefault();
        document.getElementById(`${uid}-option-${activeIndex}`)?.click();
      } else if (event.key === "Tab") setOpen(false);
    };

    return <div className="food-search-dropdown" ref={root}>
      <form onSubmit={(event) => { event.preventDefault(); void run(query, true); }}>
        <div className="search-with-action">
          <input className="meal-search-input" type="search" inputMode="search" value={query} autoFocus={autoFocus}
            onFocus={() => { if (outcome) setOpen(true); }}
            onChange={(event) => { setQuery(event.target.value); setOpen(Boolean(event.target.value.trim())); setActiveIndex(-1); }}
            onKeyDown={handleKeyDown} placeholder={t("searchPlaceholder")} autoComplete="off"
            role="combobox" aria-expanded={showPanel} aria-controls={listboxId} aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? `${uid}-option-${activeIndex}` : undefined} aria-describedby={statusId} />
          <BarcodeScanner compact onScan={(barcode) => { immediateQuery.current = barcode; setQuery(barcode); setOpen(true); void run(barcode, true); }} />
        </div>
        <span id={statusId} role="status" aria-live="polite" className="sr-only">{status}</span>
        {showPanel ? <div className="food-search-panel" id={listboxId} role="listbox">
          {loading ? <p className="food-search-message">{t("searching")}</p> : null}
          {!loading && outcome?.results.map((result, index) => <Link key={result.id} id={`${uid}-option-${index}`}
            role="option" aria-selected={activeIndex === index} className="food-search-option" href={resultHref(result)}>
            <span className="row-body"><strong>{result.name}</strong><span>{result.brand ? `${result.brand} · ` : ""}{result.nutrients.energyKcal == null ? "–" : `${formatKcal(result.nutrients.energyKcal, locale)} kcal`} {t("perBasis", { amount: formatNumber(result.basisAmount, locale, 0), unit: result.basisUnit === "ML" ? "ml" : "g" })}</span></span>
            <SourceBadge source={result.sourceType} />
          </Link>)}
          {!loading && outcome?.recipeDrafts.length ? <><div className="food-search-group">{t("drafts")}</div>{outcome.recipeDrafts.map((draft, draftIndex) => {
            const index = (outcome.results.length ?? 0) + draftIndex;
            return <Link key={draft.id} id={`${uid}-option-${index}`} role="option" aria-selected={activeIndex === index} className="food-search-option" href={`/recipes/${draft.id}`}>
              <span className="row-body"><strong>{draft.name}</strong><span>{t("ingredientCount", { count: draft.ingredientCount })}</span></span><span className="badge">{t("draft")}</span>
            </Link>;
          })}</> : null}
          {!loading && outcome && outcome.results.length === 0 && outcome.recipeDrafts.length === 0 ? <p className="food-search-message">{outcome.providerError ? providerErrorMessage(outcome.providerError) : t("noResults")}</p> : null}
          <div className="food-search-actions"><button type="submit" className="btn btn-quiet" disabled={loading || query.trim().length < 3}>{t("searchExternal")}</button><Link href={`/foods?meal=${meal}&date=${date}&editMeal=${editMeal ?? meal}`}>{t("moreResults")}</Link></div>
        </div> : null}
      </form>
    </div>;
  }

  return (
    <>
      <section className="card" style={{ marginBottom: 20 }}>
        <form onSubmit={(event) => { event.preventDefault(); void run(query, true); }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="food-query">{t("searchPlaceholder")}</label>
          <div className="search-with-action">
            <input
              id="food-query"
              type="search"
              inputMode="search"
              value={query}
              autoFocus={autoFocus}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-describedby={statusId}
              autoComplete="off"
            />
            <BarcodeScanner compact onScan={(barcode) => {
              immediateQuery.current = barcode;
              setQuery(barcode);
              void run(barcode, true);
            }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-quiet" disabled={loading || query.trim().length < 3}>
            {t("searchExternal")}
          </button>
          <span id={statusId} role="status" aria-live="polite" className="muted" style={{ fontSize: 13 }}>
          {status}
          </span>
        </div>
        </form>
      </section>

      {/* A provider outage with results in hand is a footnote, not a warning:
          the list is usable, so it gets one quiet line and a way to retry. */}
      {outcome?.providerError && outcome.results.length > 0 ? (
        <p className="muted" style={{ margin: "0 0 16px", fontSize: 13 }}>
          {t("providerDegraded", { provider: providerName(outcome.providerError.provider) })}{" "}
          <button
            type="button"
            className="btn btn-quiet"
            style={{ padding: "2px 8px", fontSize: 13 }}
            disabled={loading}
            onClick={() => void run(query, true)}
          >
            {t("retrySearch")}
          </button>
        </p>
      ) : null}

      <section className="card">
        {query.trim().length === 0 && outcome?.results.length ? <h2>{t("recentlyUsed")}</h2> : null}
        {!outcome || (outcome.results.length === 0 && outcome.recipeDrafts.length === 0) ? (
          <div className="empty">
            {query.trim().length === 0 ? (
              t("searchHint")
            ) : (
              <>
                <p style={{ margin: "0 0 6px" }}>
                  {outcome?.providerError
                    ? providerErrorMessage(outcome.providerError)
                    : outcome?.barcode
                      ? t("barcodeNotFound", { barcode: outcome.barcode })
                      : t("noResults")}
                </p>
                <p className="muted" style={{ margin: "0 0 14px" }}>
                  {t("noResultsHint")}
                </p>
                <Link className="btn btn-primary" href={`/foods/new?meal=${meal}&date=${date}&name=${encodeURIComponent(query)}`}>
                  {t("createCustom")}
                </Link>
                {outcome?.providerError ? (
                  <button type="button" className="btn" style={{ marginLeft: 8 }} disabled={loading} onClick={() => void run(query, true)}>
                    {t("retrySearch")}
                  </button>
                ) : null}
                {outcome?.suggestResearch ? (
                  researchAvailable ? (
                    <Link className="btn" style={{ marginLeft: 8 }} href={`/research/new?q=${encodeURIComponent(query)}&meal=${meal}&date=${date}`}>
                      {t("startResearch")}
                    </Link>
                  ) : (
                    <p className="muted" style={{ margin: "12px 0 0" }}>{t(`researchUnavailable.${researchUnavailableReason ?? "SERVER_DISABLED"}`)}</p>
                  )
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div className={query.trim().length === 0 ? "recent-food-list" : undefined}>
            {outcome.results.map((result) => (
              <div className="row clickable-row" key={result.id}>
                <Link className="row-main-link" href={resultHref(result)}>
                  <div className="row-body">
                    <strong>{result.name}</strong>
                    <span>
                      {result.brand ? `${result.brand} · ` : ""}
                      {result.nutrients.energyKcal === null
                        ? "–"
                        : `${formatKcal(result.nutrients.energyKcal, locale)} kcal`}{" "}
                      {t("perBasis", {
                        amount: formatNumber(result.basisAmount, locale, 0),
                        unit: result.basisUnit === "ML" ? "ml" : "g",
                      })}
                    </span>
                  </div>
                  <SourceBadge source={result.sourceType} />
                </Link>

                <Link className="btn btn-primary add-food-button" aria-label={t("servingLabel")} href={resultHref(result)}>
                  <span aria-hidden="true">＋</span>
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
      {outcome?.recipeDrafts.length ? <section className="card" style={{ marginTop: 16 }}>
        <h2>{t("drafts")}</h2>
        {outcome.recipeDrafts.map((draft) => <div className="row clickable-row" key={draft.id}>
          <Link className="row-main-link" href={`/recipes/${draft.id}`}>
            <span className="row-body"><strong>{draft.name}</strong><span>{t("ingredientCount", { count: draft.ingredientCount })}</span></span>
            <span className="badge">{t("draft")}</span>
          </Link>
        </div>)}
      </section> : null}
    </>
  );
}
