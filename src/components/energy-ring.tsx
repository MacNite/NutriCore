import { formatKcal, formatPercent } from "@/lib/format";
import type { Locale } from "@/i18n/locales";

/**
 * The ring is decorative; the same numbers are always available as text, and an
 * accessible summary describes the progress for screen readers.
 */
export function EnergyRing({
  consumed,
  target,
  locale,
  label,
  summary,
}: {
  consumed: number;
  target: number | null;
  locale: Locale;
  label: string;
  summary: string;
}) {
  const fraction = target && target > 0 ? Math.min(consumed / target, 1) : 0;
  const percent = `${(fraction * 100).toFixed(1)}%`;

  return (
    <div
      className="ring"
      style={{ "--progress": percent } as React.CSSProperties}
      role="img"
      aria-label={`${summary} ${target ? formatPercent(fraction, locale) : ""}`.trim()}
    >
      <div className="ring-text">
        {formatKcal(consumed, locale)}
        <small>{label}</small>
      </div>
    </div>
  );
}
