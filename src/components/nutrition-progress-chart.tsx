"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatDate, formatNutrient, formatNumber } from "@/lib/format";
import { NUTRIENTS } from "@/lib/nutrients";
import type { NutritionProgressPoint } from "@/lib/nutrition-progress";

const WIDTH = 720;
const HEIGHT = 280;
const PAD = { top: 22, right: 18, bottom: 34, left: 48 };
const COLORS = ["var(--accent)", "var(--carb)", "var(--fat)", "var(--focus)"];
const MACROS = ["protein", "carbohydrate", "fat"];
const MICRO_CATEGORIES = new Set(["secondary", "mineral", "vitamin"]);

export function NutritionProgressChart({ points, locale }: { points: NutritionProgressPoint[]; locale: Locale }) {
  const t = useTranslations("progress.nutrition");
  const [tab, setTab] = useState<"calories" | "macros" | "micros">("calories");
  const microKeys = useMemo(() => NUTRIENTS.filter((n) => MICRO_CATEGORIES.has(n.category) && points.some((p) => p.targets[n.key])).map((n) => n.key), [points]);
  const [selectedMicros, setSelectedMicros] = useState<string[]>(() => microKeys.slice(0, 3));
  const [enabledMacros, setEnabledMacros] = useState(MACROS);
  const [active, setActive] = useState<{ point: NutritionProgressPoint; key: string } | null>(null);
  const series = tab === "calories" ? ["energyKcal"] : tab === "macros" ? enabledMacros : selectedMicros;
  const available = series.filter((key) => points.some((point) => point.percentages[key] != null));
  const values = available.flatMap((key) => points.map((point) => point.percentages[key]).filter((value): value is number => value != null));
  const max = Math.max(125, Math.ceil((Math.max(...values, 100) + 10) / 25) * 25);
  const x = (index: number) => PAD.left + (index / Math.max(points.length - 1, 1)) * (WIDTH - PAD.left - PAD.right);
  const y = (value: number) => PAD.top + (1 - value / max) * (HEIGHT - PAD.top - PAD.bottom);
  const today = points.at(-1);
  const goals = today ? Object.values(today.percentages).filter((value) => value != null) : [];
  const reached = goals.filter((value) => value! >= 90 && value! <= 110).length;

  function toggle(key: string, current: string[], set: (keys: string[]) => void, limit?: number) {
    if (current.includes(key)) set(current.filter((value) => value !== key));
    else if (!limit || current.length < limit) set([...current, key]);
  }

  return (
    <div>
      <div className="progress-tabs" role="tablist" aria-label={t("chartType")}>
        {(["calories", "macros", "micros"] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} className="btn" onClick={() => { setTab(value); setActive(null); }}>
            {t(value)}
          </button>
        ))}
      </div>

      {tab === "macros" ? <div className="progress-filters" aria-label={t("selectNutrients")}>
        {MACROS.map((key, index) => <Filter key={key} label={name(key, locale)} color={COLORS[index]} checked={enabledMacros.includes(key)} onClick={() => toggle(key, enabledMacros, setEnabledMacros)} />)}
      </div> : null}
      {tab === "micros" && microKeys.length ? <div className="progress-filters" aria-label={t("selectNutrients")}>
        {microKeys.map((key, index) => <Filter key={key} label={name(key, locale)} color={COLORS[index % COLORS.length]} checked={selectedMicros.includes(key)} onClick={() => toggle(key, selectedMicros, setSelectedMicros, 4)} />)}
      </div> : null}

      {available.length === 0 ? <p className="empty">{tab === "micros" && microKeys.length === 0 ? t("noMicroTargets") : t("empty")}</p> : <>
        {today && goals.length ? <p className="progress-score"><strong>{t("todayReached", { reached, total: goals.length })}</strong><span>{t("balancedHint")}</span></p> : null}
        <figure className="nutrition-chart">
          <div className="table-scroll">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label={t("summary")} style={{ minWidth: 340, display: "block" }}>
              <rect x={PAD.left} y={y(110)} width={WIDTH - PAD.left - PAD.right} height={y(90) - y(110)} fill="var(--accent-soft)" opacity="0.55" />
              {[0, 50, 100, max].filter((v, i, a) => a.indexOf(v) === i).map((value) => <g key={value}>
                <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(value)} y2={y(value)} stroke={value === 100 ? "var(--accent)" : "var(--line)"} strokeWidth={value === 100 ? 2 : 1} strokeDasharray={value === 100 ? "6 4" : undefined} />
                <text x={4} y={y(value) + 4} fontSize="11" fill={value === 100 ? "var(--accent)" : "var(--text-muted)"}>{value} %</text>
              </g>)}
              <text x={WIDTH - PAD.right} y={y(100) - 7} textAnchor="end" fontSize="11" fontWeight="600" fill="var(--accent)">{t("targetLine")}</text>
              {available.map((key, seriesIndex) => {
                const segments = points.map((point, index) => point.percentages[key] == null ? null : `${x(index)},${y(point.percentages[key]!)}`);
                return <g key={key}>{segments.map((coordinate, index) => coordinate && (index === 0 || !segments[index - 1]) ? <polyline key={index} points={contiguous(segments, index)} fill="none" stroke={COLORS[seriesIndex % COLORS.length]} strokeWidth="2.5" /> : null)}
                  {points.map((point, index) => point.percentages[key] == null ? null : <circle key={point.date} cx={x(index)} cy={y(point.percentages[key]!)} r="5" fill={point.percentages[key]! >= 90 && point.percentages[key]! <= 110 ? "var(--surface)" : COLORS[seriesIndex % COLORS.length]} stroke={COLORS[seriesIndex % COLORS.length]} strokeWidth="2.5" tabIndex={0} role="button" aria-label={pointLabel(point, key, locale)} onMouseEnter={() => setActive({ point, key })} onFocus={() => setActive({ point, key })} onClick={() => setActive({ point, key })} />)}
                </g>;
              })}
              {points.map((point, index) => index === 0 || index === points.length - 1 ? <text key={point.date} x={x(index)} y={HEIGHT - 8} textAnchor={index === 0 ? "start" : "end"} fontSize="11" fill="var(--text-muted)">{formatDate(point.date, locale, { day: "2-digit", month: "2-digit" })}</text> : null)}
            </svg>
          </div>
          <figcaption className="chart-detail" aria-live="polite">{active ? <><strong>{formatDate(active.point.date, locale)} · {name(active.key, locale)} – {formatNumber(active.point.percentages[active.key]!, locale, 0)} %</strong><span>{formatNutrient(active.point.values[active.key], locale)} / {formatNutrient(active.point.targets[active.key], locale)} {unit(active.key)}{active.point.coverage[active.key] != null && active.point.coverage[active.key]! < 1 ? ` · ${t("coverage", { value: formatNumber(active.point.coverage[active.key]! * 100, locale, 0) })}` : ""}</span></> : <span>{t("interactionHint")}</span>}</figcaption>
        </figure>
      </>}
    </div>
  );
}

function contiguous(values: (string | null)[], start: number) { const out: string[] = []; for (let i = start; i < values.length && values[i]; i++) out.push(values[i]!); return out.join(" "); }
function meta(key: string) { return NUTRIENTS.find((nutrient) => nutrient.key === key); }
function name(key: string, locale: Locale) { const nutrient = meta(key); return locale === "de" ? nutrient?.nameDe ?? key : nutrient?.nameEn ?? key; }
function unit(key: string) { return meta(key)?.unit ?? ""; }
function pointLabel(point: NutritionProgressPoint, key: string, locale: Locale) { return `${formatDate(point.date, locale)}, ${name(key, locale)}, ${formatNumber(point.percentages[key]!, locale, 0)} %, ${formatNutrient(point.values[key], locale)} von ${formatNutrient(point.targets[key], locale)} ${unit(key)}`; }
function Filter({ label, color, checked, onClick }: { label: string; color: string; checked: boolean; onClick: () => void }) { return <button type="button" className="progress-chip" aria-pressed={checked} onClick={onClick}><span className="series-mark" style={{ background: color }} aria-hidden="true" />{label}<span className="sr-only">{checked ? " ausgewählt" : " nicht ausgewählt"}</span></button>; }
