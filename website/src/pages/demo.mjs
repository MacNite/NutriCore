/**
 * The demo page.
 *
 * Rendered at build time from `demo-data.mjs` so every panel is present in the
 * HTML: the page is readable, and correct, with JavaScript switched off. The
 * script that ships alongside it only adds what interaction requires - moving
 * between panels, switching the day, and filtering the search index.
 *
 * The numbers are formatted the way the German locale of the application
 * formats them, because that is what the screen being reconstructed looks like.
 */
import { days, micronutrients, profile, proposals, searchIndex, weightSeries, energySeries } from "../demo-data.mjs";
import { facts, num } from "../data.mjs";
import { page } from "../layout.mjs";

/** German number formatting, to one or zero decimals. */
const de = (value, decimals = 0) =>
  value === null || value === undefined
    ? "–"
    : value.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const SOURCE_LABEL = { BLS: "BLS", USDA: "USDA", OFF: "OFF", RECIPE: "Rezept" };
const SOURCE_CLASS = { BLS: "badge-bls", USDA: "badge-usda", OFF: "badge-off", RECIPE: "badge-recipe" };

const badge = (source) =>
  source ? `<span class="badge ${SOURCE_CLASS[source]}">${SOURCE_LABEL[source]}</span>` : "";

const dayTotals = (day) => {
  const entries = day.meals.flatMap((meal) => meal.entries);
  const sum = (key) => entries.reduce((total, entry) => total + (entry[key] ?? 0), 0);
  return { kcal: sum("kcal"), protein: sum("protein"), carb: sum("carb"), fat: sum("fat"), count: entries.length };
};

const mealKcal = (meal) => meal.entries.reduce((total, entry) => total + entry.kcal, 0);

function summary(day) {
  const totals = dayTotals(day);
  const target = profile.targets;
  const pct = (value, goal) => Math.min(100, Math.round((value / goal) * 1000) / 10);

  return `
  <div class="summary">
    <div class="ring" style="--progress:${pct(totals.kcal, target.energyKcal)}%" role="img"
         aria-label="${de(totals.kcal)} von ${de(target.energyKcal)} Kilokalorien">
      <div class="ring-text">${de(totals.kcal)}<small>kcal</small></div>
    </div>
    <div class="summary-macros">
      <div class="macro">
        <div class="macro-head"><span>Protein</span><strong>${de(totals.protein)} / ${de(target.protein)} g</strong></div>
        <div class="bar"><i style="width:${pct(totals.protein, target.protein)}%"></i></div>
      </div>
      <div class="macro">
        <div class="macro-head"><span>Kohlenhydrate</span><strong>${de(totals.carb)} / ${de(target.carbohydrate)} g</strong></div>
        <div class="bar carb"><i style="width:${pct(totals.carb, target.carbohydrate)}%"></i></div>
      </div>
      <div class="macro">
        <div class="macro-head"><span>Fett</span><strong>${de(totals.fat)} / ${de(target.fat)} g</strong></div>
        <div class="bar fat"><i style="width:${pct(totals.fat, target.fat)}%"></i></div>
      </div>
      <div class="summary-foot">
        <span>Verbleibend <b>${de(Math.max(0, target.energyKcal - totals.kcal))} kcal</b></span>
        <span>Einträge <b>${totals.count}</b></span>
        <span>Ziel <b>${de(target.energyKcal)} kcal</b></span>
      </div>
    </div>
  </div>`;
}

const entryRow = (entry) => `
        <div class="entry-row">
          <div>
            <div class="entry-name">${entry.name}${entry.brand ? ` <span class="entry-brand">· ${entry.brand}</span>` : ""} ${badge(entry.source)}${entry.estimated ? ' <span class="badge badge-est">geschätzt</span>' : ""}</div>
            <div class="entry-sub">${entry.detail}</div>
          </div>
          <div class="entry-kcal">${de(entry.kcal)}<small>kcal</small></div>
        </div>`;

const dayPanel = (day, index) => `
    <div class="demo-day" data-day="${day.id}"${index === 0 ? "" : " hidden"}>
      ${summary(day)}
      ${day.meals
        .map(
          (meal) => `
      <div class="meal-group">
        <div class="meal-head"><h3>${meal.type}</h3><span>${de(mealKcal(meal))} kcal</span></div>
        ${meal.entries.map(entryRow).join("")}
      </div>`,
        )
        .join("")}
    </div>`;

/* --- Search ---------------------------------------------------------------
   The list is rendered complete at build time and filtered in place, so the
   panel is useful without the script and instant with it. */
const searchResult = (food) => `
      <li class="result" data-name="${(food.name + " " + (food.brand ?? "")).toLowerCase()}">
        <div>
          <div class="entry-name">${food.name}${food.brand ? ` <span class="entry-brand">· ${food.brand}</span>` : ""} ${badge(food.source)}${food.estimated ? ' <span class="badge badge-est">geschätzt</span>' : ""}</div>
          <div class="entry-sub">${food.code ? food.code + " · " : ""}Vollständigkeit ${de(food.completeness * 100)} %</div>
        </div>
        <div class="entry-kcal">${de(food.kcal)}<small>kcal / 100 g</small></div>
      </li>`;

/* --- Progress -------------------------------------------------------------
   Two hand-drawn charts rather than a charting library: nine points and eight
   bars do not need one, and inline SVG inherits the page's theme. */
function weightChart() {
  const width = 520;
  const height = 170;
  const pad = { left: 34, right: 12, top: 14, bottom: 26 };
  const values = weightSeries.map((point) => point.kg);
  const min = Math.floor(Math.min(...values) * 2) / 2 - 0.5;
  const max = Math.ceil(Math.max(...values) * 2) / 2 + 0.5;
  const x = (index) => pad.left + (index * (width - pad.left - pad.right)) / (weightSeries.length - 1);
  const y = (value) => pad.top + ((max - value) / (max - min)) * (height - pad.top - pad.bottom);

  const line = weightSeries.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(point.kg).toFixed(1)}`).join(" ");
  const area = `${line} L${x(weightSeries.length - 1).toFixed(1)} ${height - pad.bottom} L${pad.left} ${height - pad.bottom} Z`;
  const ticks = [max, (max + min) / 2, min];

  return `
  <svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gewicht von ${de(values[0], 1)} auf ${de(values[values.length - 1], 1)} Kilogramm">
    ${ticks
      .map(
        (tick) =>
          `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(1)}" />
     <text class="axis" x="4" y="${(y(tick) + 3).toFixed(1)}">${de(tick, 1)}</text>`,
      )
      .join("\n    ")}
    <path class="trend-soft" d="${area}" />
    <path class="trend" d="${line}" />
    ${weightSeries.map((point, index) => `<circle class="point" cx="${x(index).toFixed(1)}" cy="${y(point.kg).toFixed(1)}" r="2.6" />`).join("")}
    ${weightSeries
      .filter((_, index) => index % 2 === 0)
      .map((point) => `<text class="axis" x="${x(weightSeries.indexOf(point)).toFixed(1)}" y="${height - 8}" text-anchor="middle">${point.day}</text>`)
      .join("")}
  </svg>`;
}

function energyChart() {
  const width = 520;
  const height = 150;
  const pad = { left: 34, right: 12, top: 14, bottom: 24 };
  const max = 2800;
  const barWidth = (width - pad.left - pad.right) / energySeries.length - 8;
  const targetY = pad.top + ((max - profile.targets.energyKcal) / max) * (height - pad.top - pad.bottom);

  return `
  <svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="Energie der letzten acht Tage gegen das Ziel von ${de(profile.targets.energyKcal)} Kilokalorien">
    <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${targetY.toFixed(1)}" y2="${targetY.toFixed(1)}" stroke-dasharray="4 4" />
    <text class="axis" x="4" y="${(targetY + 3).toFixed(1)}">${de(profile.targets.energyKcal)}</text>
    ${energySeries
      .map((value, index) => {
        const barX = pad.left + index * ((width - pad.left - pad.right) / energySeries.length) + 4;
        const barY = pad.top + ((max - value) / max) * (height - pad.top - pad.bottom);
        const barHeight = height - pad.bottom - barY;
        return `<rect class="bar-mark" x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3" />`;
      })
      .join("\n    ")}
    <text class="axis" x="${pad.left}" y="${height - 6}">vor 8 Tagen</text>
    <text class="axis" x="${width - pad.right}" y="${height - 6}" text-anchor="end">heute</text>
  </svg>`;
}

const nutrientRow = (nutrient) => {
  const share = nutrient.value !== null && nutrient.reference ? Math.round((nutrient.value / nutrient.reference) * 100) : null;
  return `
        <div class="nutrient-row">
          <span>${nutrient.name}</span>
          <b>${nutrient.value === null ? "–" : de(nutrient.value, nutrient.value < 100 ? 1 : 0)} ${nutrient.unit}</b>
          <span class="pct">${share === null ? "–" : share + " %"}</span>
        </div>`;
};

const proposalCard = (proposal) => `
      <article class="review-item">
        <header>
          <h4>${proposal.title}</h4>
          <span class="entry-sub">${proposal.meta}</span>
        </header>
        <ul class="review-components">
          ${proposal.components
            .map(
              (component) => `
          <li>
            <span>${component.name}${component.resolved ? ` <span style="color:var(--ink-3)">&rarr; ${component.resolved}</span>` : ' <span class="badge badge-est">nicht zugeordnet</span>'}</span>
            <span>${component.grams ? de(component.grams) + " g" : "–"}</span>
            ${badge(component.source)}
          </li>`,
            )
            .join("")}
        </ul>
        <div class="review-actions">
          <span class="mini-btn primary">Übernehmen</span>
          <span class="mini-btn">Bearbeiten</span>
          <span class="mini-btn">Verwerfen</span>
        </div>
      </article>`;

const TABS = [
  { id: "diary", label: "Tagebuch" },
  { id: "search", label: "Suche" },
  { id: "nutrients", label: "Nährstoffe" },
  { id: "progress", label: "Verlauf" },
  { id: "review", label: "KI-Review" },
];

const body = `
<section class="band-tight" style="padding-top:clamp(2.5rem,5vw,4rem)">
  <div class="shell grid">
    <div class="section-head" style="grid-column:span 7;margin-bottom:0">
      <p class="eyebrow">Interactive demo &middot; static fixture</p>
      <h1 class="h2">The screens, with the data standing still.</h1>
      <p class="lede" style="margin-top:1rem">
        A reconstruction of the day view, the food search, the micronutrient
        breakdown, the progress charts and the AI review queue. It runs entirely
        in your browser against a fixed dataset &mdash; nothing is stored, nothing
        is sent, and the panels are present in the HTML before any script runs.
      </p>
    </div>
    <div style="grid-column:span 5;align-self:end">
      <div class="figure">
      <p class="eyebrow plain" style="margin-bottom:0.9rem">What you are looking at</p>
      <ul class="meta-list" style="border-top:0;padding-top:0;margin-top:0">
        <li><span class="key">Locale</span><span>Deutsch &mdash; the application ships German and English</span></li>
        <li><span class="key">Sources</span><span>BLS &middot; USDA &middot; Open Food Facts &middot; own recipes</span></li>
        <li><span class="key">Not shown</span><span>Login, onboarding, admin, invitations, settings</span></li>
      </ul>
      </div>
    </div>
  </div>
</section>

<section class="band-tight" style="padding-top:0">
  <div class="shell">
    <div class="demo-shell">
      <aside class="demo-rail">
        <div class="demo-user">
          <span class="avatar">${profile.initials}</span>
          <div>
            <b>${profile.name}</b>
            <span>Ziel: 2.404 kcal</span>
          </div>
        </div>
        <div class="demo-tabs" role="tablist" aria-label="Demo screens">
          ${TABS.map(
            (tab, index) => `<button class="demo-tab" type="button" role="tab" id="tab-${tab.id}"
            aria-controls="panel-${tab.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}"><i></i>${tab.label}</button>`,
          ).join("\n          ")}
        </div>
        <p class="demo-rail-note">
          ${profile.basis}. Every figure on this screen is a fixture in
          website/src/demo-data.mjs.
        </p>
      </aside>

      <div class="demo-main">
        <div class="demo-topbar">
          <div>
            <p class="demo-date" data-demo-date>${days[0].label}</p>
            <h2 data-demo-heading>Tagebuch</h2>
          </div>
          <div class="chips" data-day-switch>
            ${days
              .map(
                (day, index) =>
                  `<button class="chip${index === 0 ? " chip-accent" : ""}" type="button" data-day-button="${day.id}" data-long="${day.label}">${day.short}</button>`,
              )
              .join("\n            ")}
          </div>
        </div>

        <div class="demo-panel" id="panel-diary" role="tabpanel" aria-labelledby="tab-diary">
          ${days.map(dayPanel).join("\n")}
        </div>

        <div class="demo-panel" id="panel-search" role="tabpanel" aria-labelledby="tab-search" hidden>
          <div class="search-field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.4"/><path d="M15.8 15.8 20 20"/></svg>
            <input type="search" placeholder="Lebensmittel suchen — z. B. Linsen, Hafer, Skyr" aria-label="Lebensmittel suchen" data-search-input />
          </div>
          <div class="search-meta">
            <span data-search-count>${searchIndex.length} Treffer</span>
            <span>Tier: LOCAL &rarr; BLS &middot; USDA &rarr; OPEN_FOOD_FACTS</span>
            <span>Abbruch bei Identität &amp; Vollständigkeit &ge; 75 %</span>
          </div>
          <ul class="result-list" data-search-list>
            ${searchIndex.map(searchResult).join("")}
          </ul>
          <p class="result-empty" hidden data-search-empty>
            Keine lokalen Treffer. Die echte Suche würde jetzt die nächste
            Quelle befragen &mdash; hier endet der Fixture-Datensatz.
          </p>
        </div>

        <div class="demo-panel" id="panel-nutrients" role="tabpanel" aria-labelledby="tab-nutrients" hidden>
          <p class="entry-sub" style="margin-bottom:1rem">
            Tagessumme gegen die Referenzzufuhr. Ein Nährstoff, den keines der
            Lebensmittel angibt, bleibt leer &mdash; er wird nie als 0 gezeigt.
          </p>
          <div class="nutrient-grid">
            ${micronutrients.map(nutrientRow).join("")}
          </div>
          <div class="callout" style="margin-top:1.4rem">
            <strong>${facts.nutrients} Nährstoffe insgesamt.</strong> Die
            vollständige Tabelle steht in src/lib/nutrients.ts &mdash;
            ${facts.vitamins} Vitamine, ${facts.minerals} Mineralstoffe, dazu
            Energie, Makros und die Sekundärwerte eines Etiketts.
          </div>
        </div>

        <div class="demo-panel" id="panel-progress" role="tabpanel" aria-labelledby="tab-progress" hidden>
          <div class="chart-card">
            <div class="meal-head" style="border:0;padding:0;margin-bottom:0.6rem"><h3>Gewicht &middot; 30 Tage</h3><span>−2,2 kg</span></div>
            ${weightChart()}
          </div>
          <div class="chart-card" style="margin-top:1rem">
            <div class="meal-head" style="border:0;padding:0;margin-bottom:0.6rem"><h3>Energie &middot; 8 Tage</h3><span>Ø 2.247 kcal</span></div>
            ${energyChart()}
          </div>
          <div class="stat-row">
            <div class="stat"><b>76,2 kg</b><span>letzter Eintrag</span></div>
            <div class="stat"><b class="delta">−2,2 kg</b><span>seit dem 7. August</span></div>
            <div class="stat"><b>−157 kcal</b><span>Ø Abweichung vom Ziel</span></div>
            <div class="stat"><b>24 / 30</b><span>Tage mit Einträgen</span></div>
          </div>
        </div>

        <div class="demo-panel" id="panel-review" role="tabpanel" aria-labelledby="tab-review" hidden>
          <p class="entry-sub" style="margin-bottom:1rem">
            Zwei offene Vorschläge. Nichts davon steht im Tagebuch, bevor es hier
            bestätigt wurde &mdash; und eine Komponente ohne zugeordnetes
            Lebensmittel wird nie übernommen.
          </p>
          ${proposals.map(proposalCard).join("")}
          <div class="callout warn">
            <strong>Frühlingszwiebel konnte nicht zugeordnet werden.</strong>
            Das Modell darf einen Namen nennen, aber niemals Nährwerte liefern.
            Ohne passendes Lebensmittel bleibt die Zeile offen.
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="band band-line band-fill">
  <div class="shell grid">
    <div class="section-head" style="grid-column:span 5;margin-bottom:0">
      <p class="eyebrow">What this page is not</p>
      <h2 class="h2">A fixture, honestly labelled.</h2>
    </div>
    <div style="grid-column:span 7">
      <div class="prose">
        <p>
          There is no database behind this page and no request leaves it. The
          diary, the charts and the review queue read a JavaScript object that
          ships with the site; the search filters that same object rather than
          traversing real sources.
        </p>
        <p>
          What is faithful is the <strong>shape</strong>: the source badge on
          every entry, the estimate marker, the dash where a nutrient is absent,
          the unresolved component that cannot be approved. Those are the parts
          of the interface that carry the argument, so those are the parts worth
          reconstructing.
        </p>
      </div>
      <div class="hero-actions">
        <a class="btn btn-primary" href="build.html">Run the real thing<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
        <a class="btn btn-secondary" href="${facts.repo}" rel="noreferrer noopener">Read the source</a>
      </div>
    </div>
  </div>
</section>
`;

export const demo = page({
  id: "demo",
  title: "NutriCore demo — the day view, running on a static fixture",
  description: `An interactive reconstruction of NutriCore's diary, food search across ${num(facts.foods.total)} bundled foods, micronutrient breakdown, progress charts and AI review queue. Static data, no server.`,
  body,
  scripts: ["assets/demo.js"],
});
