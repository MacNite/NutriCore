import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { BodyCheckinForm } from "@/components/body-progress/body-checkin-form";
import { BodyProgressPreview } from "@/components/body-progress/body-progress-preview";
import { getSessionUser } from "@/server/session";
import { formatDateKey } from "@/server/diary";
import { MOCK_MEASUREMENTS, MOCK_PROFILE, MOCK_REFERENCE_INDEX } from "@/lib/body-mock-data";

export async function generateMetadata() {
  const t = await getTranslations("bodyProgress");
  return { title: t("title") };
}

/**
 * DESIGN PREVIEW — /progress/body-preview.
 *
 * A body-progress hero, key figures, a measurement time series and the
 * measurement detail, all driven by mock data so the interaction design can be
 * judged before any schema or persistence exists. Nothing here touches the
 * database; promoting it into /progress means swapping the mock import for real
 * queries and deleting this route.
 */
export default async function BodyProgressPreviewPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const t = await getTranslations("bodyProgress");
  const progress = await getTranslations("progress");

  return (
    <AppShell displayName={user.displayName}>
      <div className="page-head">
        <div>
          <div className="body-preview-head">
            <h1>{t("title")}</h1>
            <span className="badge badge-ai">
              <span aria-hidden="true">✦</span>
              {t("previewBadge")}
            </span>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {t("intro")}
          </p>
        </div>
        <BodyCheckinForm today={formatDateKey(new Date())} />
      </div>

      <div className="notice notice-warn" role="note" style={{ marginBottom: 20 }}>
        <span className="notice-icon" aria-hidden="true">
          !
        </span>
        <span>{t("previewNote")}</span>
      </div>

      <BodyProgressPreview
        measurements={MOCK_MEASUREMENTS}
        profile={MOCK_PROFILE}
        defaultReferenceIndex={MOCK_REFERENCE_INDEX}
        locale={user.language}
      />

      <section className="card" style={{ marginTop: 20 }} aria-labelledby="body-existing-heading">
        <h2 id="body-existing-heading">{t("existing.title")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("existing.body")}
        </p>
        <p style={{ margin: 0 }}>
          <Link href="/progress">
            {`${t("existing.link")} — ${progress("weight")} · ${progress("nutrition.title")}`}
          </Link>
        </p>
      </section>
    </AppShell>
  );
}
