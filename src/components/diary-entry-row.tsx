"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { deleteEntryAction, updateEntryAction } from "@/server/diary-actions";
import { formatKcal, formatNumber } from "@/lib/format";
import type { Locale } from "@/i18n/locales";

export interface EntryView {
  id: string;
  label: string;
  brand: string | null;
  quantity: number;
  unit: string;
  kcal: number | null;
  sourceType: string;
  /** Detail page of what was logged, when the entry still points at one. */
  href?: string | null;
}

export function DiaryEntryRow({
  entry,
  date,
  locale,
  badge,
}: {
  entry: EntryView;
  date: string;
  locale: Locale;
  badge: React.ReactNode;
}) {
  const t = useTranslations("diary");
  const common = useTranslations("common");
  const a11y = useTranslations("a11y");
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <form
        className="row"
        action={async (formData: FormData) => {
          await updateEntryAction({}, formData);
          setEditing(false);
        }}
      >
        <input type="hidden" name="entryId" value={entry.id} />
        <input type="hidden" name="date" value={date} />

        <div className="row-body">
          <strong>{entry.label}</strong>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <label className="sr-only" htmlFor={`qty-${entry.id}`}>
              {t("amount")}
            </label>
            <input
              id={`qty-${entry.id}`}
              name="quantity"
              type="number"
              min="0.1"
              step="0.1"
              defaultValue={entry.quantity}
              style={{ maxWidth: 110 }}
              autoFocus
            />
            <label className="sr-only" htmlFor={`unit-${entry.id}`}>
              {t("unit")}
            </label>
            <input id={`unit-${entry.id}`} name="unit" type="text" defaultValue={entry.unit} style={{ maxWidth: 90 }} />
          </div>
        </div>

        <button type="submit" className="btn btn-primary">
          {common("save")}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>
          {common("cancel")}
        </button>
      </form>
    );
  }

  // What the row says about the entry - name, amount, source, energy - is also
  // the way to the food or recipe behind it. Only the reading part is the link:
  // the edit and remove controls stay their own buttons next to it, and an
  // entry whose food has since been deleted simply has nowhere to lead.
  const body = (
    <>
      <div className="row-body">
        <strong>{entry.label}</strong>
        <span>
          {entry.brand ? `${entry.brand} · ` : ""}
          {formatNumber(entry.quantity, locale)} {entry.unit}
        </span>
      </div>

      {badge}

      <span className="row-value">{entry.kcal === null ? "–" : `${formatKcal(entry.kcal, locale)} kcal`}</span>
    </>
  );

  return (
    <div className={entry.href ? "row clickable-row" : "row"}>
      {entry.href ? (
        <Link className="row-main-link" href={entry.href} aria-label={a11y("openEntry", { name: entry.label })}>
          {body}
        </Link>
      ) : (
        body
      )}

      <div className="row-actions">
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => setEditing(true)}
          aria-label={a11y("editEntry", { name: entry.label })}
        >
          <span aria-hidden="true">✎</span>
        </button>

        <form
          action={async (formData: FormData) => {
            await deleteEntryAction({}, formData);
          }}
        >
          <input type="hidden" name="entryId" value={entry.id} />
          <input type="hidden" name="date" value={date} />
          <button type="submit" className="btn btn-quiet" aria-label={a11y("removeEntry", { name: entry.label })}>
            <span aria-hidden="true">×</span>
          </button>
        </form>
      </div>
    </div>
  );
}
