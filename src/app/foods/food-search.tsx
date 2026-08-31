"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SourceBadge } from "@/components/source-badge";
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
}

interface Outcome {
  results: Result[];
  barcode: string | null;
  providerError: {
    provider: string;
    reason: "RATE_LIMITED" | "TIMEOUT" | "NETWORK" | "HTTP_ERROR" | "UNAVAILABLE";
    retryAfterSeconds?: number;
  } | null;
  suggestResearch: boolean;
}

const DEBOUNCE_MS = 500;

export function FoodSearch({
  meal,
  date,
  locale,
  autoFocus,
  researchAvailable,
  researchUnavailableReason,
}: {
  meal: string;
  date: string;
  locale: Locale;
  autoFocus?: boolean;
  researchAvailable: boolean;
  researchUnavailableReason?: "SERVER_DISABLED" | "AI_DISABLED";
}) {
  const t = useTranslations("foods");
  const errors = useTranslations("errors");
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState(false);
  const statusId = useId();
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(
    async (value: string, remote = false) => {
      controller.current?.abort();

      const next = new AbortController();
      controller.current = next;
      setLoading(true);

      try {
        const barcode = /^\d{8}$|^\d{12,14}$/.test(value.trim());
        const params = new URLSearchParams({ q: value, meal, remote: remote || barcode ? "1" : "0" });
        const response = await fetch(`/api/foods/search?${params}`, { signal: next.signal });
        if (!response.ok) {
          if (response.status === 429) {
            const retryAfterSeconds = Number(response.headers.get("Retry-After")) || undefined;
            setOutcome((current) => ({
              results: current?.results ?? [], barcode: current?.barcode ?? null, suggestResearch: current?.suggestResearch ?? true,
              providerError: { provider: "NUTRICORE", reason: "RATE_LIMITED", retryAfterSeconds },
            }));
            return;
          }
          throw new Error(String(response.status));
        }
        setOutcome((await response.json()) as Outcome);
      } catch (error) {
        // An aborted request is the normal result of typing another character.
        if ((error as Error).name !== "AbortError") {
          setOutcome({
            results: [],
            barcode: null,
            providerError: { provider: "UNKNOWN", reason: "UNAVAILABLE" },
            suggestResearch: true,
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [meal],
  );

  // Autocomplete is PostgreSQL-only: OFF is contacted by the button, or by a
  // complete barcode as one discrete remote lookup.
  useEffect(() => {
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  useEffect(() => () => controller.current?.abort(), []);

  const providerErrorMessage = useCallback(
    (error: NonNullable<Outcome["providerError"]>) => {
      const provider = error.provider === "OPEN_FOOD_FACTS" ? "Open Food Facts" : error.provider;
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
    if (outcome.results.length === 0) {
      if (outcome.providerError) return providerErrorMessage(outcome.providerError);
      return t("noResults");
    }
    return `${outcome.results.length}`;
  }, [loading, outcome, providerErrorMessage, t]);

  return (
    <>
      <section className="card" style={{ marginBottom: 20 }}>
        <form onSubmit={(event) => { event.preventDefault(); void run(query, true); }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="food-query">{t("searchPlaceholder")}</label>
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

      {outcome?.providerError && outcome.results.length > 0 ? (
        <div className="notice notice-warn" style={{ marginBottom: 16 }}>
          <span className="notice-icon" aria-hidden="true">
            !
          </span>
          <span>
            {providerErrorMessage(outcome.providerError)}
            <br />
            <span className="muted">{errors("manualFallback")}</span>
          </span>
        </div>
      ) : null}

      <section className="card">
        {query.trim().length === 0 && outcome?.results.length ? <h2>{t("recentlyUsed")}</h2> : null}
        {!outcome || outcome.results.length === 0 ? (
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
          outcome.results.map((result) => (
            <div className="row" key={result.id}>
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

              <Link className="btn btn-primary" href={`/foods/${result.id}?meal=${meal}&date=${date}`}>
                {t("servingLabel")}
              </Link>
            </div>
          ))
        )}
      </section>
    </>
  );
}
