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
    reason: "RATE_LIMITED" | "TIMEOUT" | "UNAVAILABLE";
  } | null;
  suggestResearch: boolean;
}

const DEBOUNCE_MS = 500;

export function FoodSearch({
  meal,
  date,
  locale,
  autoFocus,
}: {
  meal: string;
  date: string;
  locale: Locale;
  autoFocus?: boolean;
}) {
  const t = useTranslations("foods");
  const errors = useTranslations("errors");
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState(false);
  const statusId = useId();
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(
    async (value: string) => {
      controller.current?.abort();
      if (value.trim().length === 0) {
        setOutcome(null);
        setLoading(false);
        return;
      }

      const next = new AbortController();
      controller.current = next;
      setLoading(true);

      try {
        const params = new URLSearchParams({ q: value, meal });
        const response = await fetch(`/api/foods/search?${params}`, { signal: next.signal });
        if (!response.ok) throw new Error(String(response.status));
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

  // Debounced so a remote provider is never hit on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  useEffect(() => () => controller.current?.abort(), []);

  const providerErrorMessage = useCallback(
    (error: NonNullable<Outcome["providerError"]>) => {
      const provider = error.provider === "OPEN_FOOD_FACTS" ? "Open Food Facts" : error.provider;
      if (error.reason === "RATE_LIMITED") return t("providerRateLimited", { provider });
      if (error.reason === "TIMEOUT") return t("providerTimeout", { provider });
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

        <p id={statusId} role="status" aria-live="polite" className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
          {status}
        </p>
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
