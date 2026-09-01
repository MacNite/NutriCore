"use client";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ACTIVITIES, findActivityVariant } from "@/lib/activities";
import { deleteActivityAction, saveActivityAction } from "@/server/activity-actions";
import { formatKcal } from "@/lib/format";
import type { Locale } from "@/i18n/locales";

export interface ActivityEntryView { id: string; activityKey: string; intensityKey: string; durationMinutes: number; activeKcalSnapshot: number | null }

function ActivityForm({ date, entry, done }: { date: string; entry?: ActivityEntryView; done: () => void }) {
  const t = useTranslations("activity");
  const common = useTranslations("common");
  const initial = ACTIVITIES.find((a) => a.key === entry?.activityKey) ?? ACTIVITIES[0];
  const [activityKey, setActivityKey] = useState(initial.key);
  const activity = ACTIVITIES.find((a) => a.key === activityKey) ?? ACTIVITIES[0];
  const entryVariant = activity.key === entry?.activityKey ? entry.intensityKey : undefined;
  const [variantKey, setVariantKey] = useState(entryVariant ?? activity.variants[0].key);
  const selectedVariant = activity.variants.some((v) => v.key === variantKey) ? variantKey : activity.variants[0].key;
  return <form className="activity-form" action={async (data) => { const result = await saveActivityAction({}, data); if (result.ok) done(); }}>
    {entry ? <input type="hidden" name="id" value={entry.id} /> : null}<input type="hidden" name="date" value={date} />
    <div className="field"><label htmlFor={`activity-${entry?.id ?? "new"}`}>{t("activity")}</label><select id={`activity-${entry?.id ?? "new"}`} name="activityKey" value={activityKey} onChange={(event) => { const next = ACTIVITIES.find((a) => a.key === event.target.value) ?? ACTIVITIES[0]; setActivityKey(next.key); setVariantKey(next.variants[0].key); }}>{ACTIVITIES.map((item) => <option value={item.key} key={item.key}>{t(`names.${item.key}`)}</option>)}</select></div>
    {activity.variants.length > 1 ? <div className="field"><label htmlFor={`intensity-${entry?.id ?? "new"}`}>{t("intensity")}</label><select id={`intensity-${entry?.id ?? "new"}`} name="intensityKey" value={selectedVariant} onChange={(e) => setVariantKey(e.target.value)}>{activity.variants.map((variant) => <option key={variant.key} value={variant.key}>{t(`variants.${variant.key}`)}</option>)}</select></div> : <input type="hidden" name="intensityKey" value={activity.variants[0].key} />}
    <div className="field"><label htmlFor={`duration-${entry?.id ?? "new"}`}>{t("duration")}</label><input id={`duration-${entry?.id ?? "new"}`} name="durationMinutes" type="number" min="1" max="1440" step="1" required defaultValue={entry?.durationMinutes ?? 30} /></div>
    <div className="activity-form-actions"><button className="btn btn-primary" type="submit">{common("save")}</button><button className="btn btn-quiet" type="button" onClick={done}>{common("cancel")}</button></div>
  </form>;
}

export function ActivityEditor({ date, entries, totalActiveKcal, locale }: { date: string; entries: ActivityEntryView[]; totalActiveKcal: number | null; locale: Locale }) {
  const t = useTranslations("activity"); const common = useTranslations("common");
  const [adding, setAdding] = useState(false); const [editing, setEditing] = useState<string | null>(null);
  return <div className="activity-editor">
    <div className="editor-actions"><button type="button" className="btn btn-quiet" onClick={() => setAdding(true)}><span aria-hidden="true">＋</span> {common("add")}</button></div>
    {adding ? <ActivityForm date={date} done={() => setAdding(false)} /> : null}
    {entries.length === 0 && !adding ? <p className="empty">{t("empty")}</p> : entries.map((entry) => {
      const resolved = findActivityVariant(entry.activityKey, entry.intensityKey); const name = t(`names.${entry.activityKey}`);
      if (editing === entry.id) return <ActivityForm key={entry.id} date={date} entry={entry} done={() => setEditing(null)} />;
      return <div className="row" key={entry.id}><div className="row-body"><strong>{name}</strong><span>{resolved && resolved.activity.variants.length > 1 ? `${t(`variants.${entry.intensityKey}`)} · ` : ""}{entry.durationMinutes} {t("minutes")}</span></div><span className="row-value">{entry.activeKcalSnapshot == null ? "–" : `${formatKcal(entry.activeKcalSnapshot, locale)} ${common("kcal")}`}</span><div className="row-actions"><button type="button" className="btn btn-quiet" onClick={() => setEditing(entry.id)} aria-label={t("editLabel", { name })}><span aria-hidden="true">✎</span></button><form action={async (data) => { await deleteActivityAction({}, data); }}><input type="hidden" name="id" value={entry.id} /><button type="submit" className="btn btn-quiet" aria-label={t("deleteLabel", { name })}><span aria-hidden="true">×</span></button></form></div></div>;
    })}
    {entries.some((entry) => entry.activeKcalSnapshot == null) ? <p className="notice notice-warn">{t("noWeight")} <Link href="/settings">{t("addWeight")}</Link></p> : null}
    {entries.length ? <div className="activity-total"><span>{t("activeCalories")}</span><strong>{totalActiveKcal == null ? "–" : `${formatKcal(totalActiveKcal, locale)} ${common("kcal")}`}</strong></div> : null}
  </div>;
}
