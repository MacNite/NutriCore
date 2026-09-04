"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatDate, formatKcal } from "@/lib/format";

const WIDTH = 760;
const HEIGHT = 250;
const PAD = { top: 18, right: 18, bottom: 32, left: 54 };

export interface ActivityProgressPoint { date: string; activeKcal: number }

export function ActivityProgressChart({ points, locale }: { points: ActivityProgressPoint[]; locale: Locale }) {
  const t = useTranslations("progress.activity");
  const [active, setActive] = useState<number | null>(null);
  if (points.length === 0) return <p className="empty">{t("empty")}</p>;

  const first = Date.parse(`${points[0].date}T00:00:00Z`);
  const last = Date.parse(`${points[points.length - 1].date}T00:00:00Z`);
  const span = Math.max(last - first, 86_400_000);
  const max = Math.max(...points.map((point) => point.activeKcal), 1);
  const x = (date: string) => PAD.left + ((Date.parse(`${date}T00:00:00Z`) - first) / span) * (WIDTH - PAD.left - PAD.right);
  const y = (value: number) => PAD.top + (1 - value / (max * 1.1)) * (HEIGHT - PAD.top - PAD.bottom);
  const selected = active === null ? null : points[active];

  return (
    <figure className="nutrition-chart body-series-chart">
      <div className="table-scroll">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label={t("summary", { from: formatDate(points[0].date, locale), to: formatDate(points[points.length - 1].date, locale), max: formatKcal(max, locale) })} style={{ minWidth: 340, display: "block" }}>
          {[0, max / 2, max].map((value) => <g key={value}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(value)} y2={y(value)} stroke="var(--line)" />
            <text x={4} y={y(value) + 4} fontSize="11" fill="var(--text-muted)">{formatKcal(value, locale)}</text>
          </g>)}
          <path d={points.map((point, index) => `${index ? "L" : "M"}${x(point.date)},${y(point.activeKcal)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
          {points.map((point, index) => <circle key={point.date} cx={x(point.date)} cy={y(point.activeKcal)} r="4" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" tabIndex={0} aria-label={`${formatDate(point.date, locale)}: ${formatKcal(point.activeKcal, locale)} kcal`} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} />)}
          {[points[0], points[points.length - 1]].map((point, index) => <text key={`${point.date}-${index}`} x={x(point.date)} y={HEIGHT - 8} textAnchor={index ? "end" : "start"} fontSize="11" fill="var(--text-muted)">{formatDate(point.date, locale, { day: "2-digit", month: "2-digit" })}</text>)}
        </svg>
      </div>
      <figcaption className="chart-detail" aria-live="polite">{selected ? <strong>{formatDate(selected.date, locale)} · {formatKcal(selected.activeKcal, locale)} kcal</strong> : <span>{t("hint")}</span>}</figcaption>
    </figure>
  );
}
