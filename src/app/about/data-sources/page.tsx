import { BackButton } from "@/components/back-button";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";

export async function generateMetadata() {
  const t = await getTranslations("dataSources");
  return { title: t("title") };
}

export default async function DataSourcesPage() {
  const t = await getTranslations("dataSources");
  const foods = await getTranslations("foods");
  const config = env();

  // Listed in the order a German search consults them, so the page reads as
  // the tier model rather than as an alphabetical inventory. FatSecret appears
  // only where it is actually configured: it is off in almost every
  // installation, and a card explaining a source that will never answer is
  // noise.
  const providers = [
    { key: "USER", body: t("ownBody"), enabled: true, url: null },
    { key: "BLS", body: t("blsBody"), enabled: config.BLS_ENABLED, url: "https://blsdb.de/" },
    { key: "OPEN_FOOD_FACTS", body: t("offBody"), enabled: config.OPENFOODFACTS_ENABLED, url: "https://world.openfoodfacts.org" },
    { key: "USDA", body: t("usdaBody"), enabled: config.USDA_ENABLED, url: "https://fdc.nal.usda.gov" },
    ...(config.FATSECRET_ENABLED
      ? ([{ key: "FATSECRET", body: t("fatSecretBody"), enabled: true, url: "https://platform.fatsecret.com" }] as const)
      : []),
  ] as const;

  return (
    <div className="shell" style={{ maxWidth: 760 }}>
      <main id="main">
        {/* The same back control as everywhere else. This page carries no app
            shell, so the button is placed here rather than being inherited. */}
        <p>
          <BackButton />
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

          {/* Which source is asked first, and why it depends on the language.
              Users notice that a German search finds different things than an
              English one; this is where that is explained. */}
          <section className="card">
            <div className="card-head"><h2>{t("orderTitle")}</h2></div>
            <p style={{ marginTop: 0 }}>{t("orderBody")}</p>
            <ul style={{ marginBottom: 0 }}>
              <li>{t("orderDe")}</li>
              <li>{t("orderEn")}</li>
              <li>{t("orderBarcode")}</li>
            </ul>
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
