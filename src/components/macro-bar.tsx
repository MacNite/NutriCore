import { formatNumber } from "@/lib/format";
import type { Locale } from "@/i18n/locales";

/**
 * Progress is conveyed by the numbers first; the bar is a secondary cue, and
 * exceeding a target is never rendered as an alarming red state.
 */
export function MacroBar({
  label,
  value,
  target,
  locale,
  variant,
}: {
  label: string;
  value: number | null;
  target: number | null;
  locale: Locale;
  variant?: "carb" | "fat";
}) {
  const fraction = target && target > 0 && value !== null ? Math.min(value / target, 1) : 0;

  return (
    <div className="macro">
      <div className="macro-head">
        <span>{label}</span>
        <strong>
          {value === null ? "–" : formatNumber(value, locale, 0)}
          {target ? ` / ${formatNumber(target, locale, 0)}` : ""} g
        </strong>
      </div>
      <div className={`bar${variant ? ` ${variant}` : ""}`}>
        <i style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}
