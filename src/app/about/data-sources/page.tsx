import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";

export async function generateMetadata() {
  const t = await getTranslations("dataSources");
  return { title: t("title") };
}

export default async function DataSourcesPage() {
  const t = await getTranslations("dataSources");
  const foods = await getTranslations("foods");
  const nav = await getTranslations("nav");
  const config = env();

  const providers = [
    { key: "OPEN_FOOD_FACTS", body: t("offBody"), enabled: config.OPENFOODFACTS_ENABLED, url: "https://world.openfoodfacts.org" },
    { key: "USDA", body: t("usdaBody"), enabled: config.USDA_ENABLED, url: "https://fdc.nal.usda.gov" },
    { key: "USER", body: t("ownBody"), enabled: true, url: null },
  ] as const;

  return (
    <div className="shell" style={{ maxWidth: 760 }}>
      <main id="main">
        <p>
          <Link href="/">← {nav("today")}</Link>
        </p>

        <div className="page-head">
          <div>
            <h1>{t("title")}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {t("subtitle")}
            </p>
          </div>
        </div>

        <div className="stack">
          {providers.map((provider) => (
            <section className="card" key={provider.key}>
              <div className="card-head">
                <h2>{foods(`sourceFull.${provider.key}` as "sourceFull.USER")}</h2>
                <span className="badge">{provider.enabled ? t("configured") : t("notConfigured")}</span>
              </div>
              <p style={{ marginTop: 0 }}>{provider.body}</p>
              {provider.url ? (
                <p style={{ marginBottom: 0 }}>
                  <a href={provider.url} rel="noreferrer noopener external" target="_blank">
                    {provider.url}
                  </a>
                </p>
              ) : null}
            </section>
          ))}

          <section className="card">
            <div className="card-head"><h2>{t("compendiumTitle")}</h2><span className="badge">{t("configured")}</span></div>
            <p style={{ marginTop: 0 }}>{t("compendiumBody")}</p>
            <p style={{ marginBottom: 0 }}><a href="https://pacompendium.com/" rel="noreferrer noopener external" target="_blank">https://pacompendium.com/</a></p>
          </section>

          <section className="card">
            <div className="notice">
              <span className="notice-icon" aria-hidden="true">
                ⓘ
              </span>
              <span>{t("shareAlike")}</span>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
