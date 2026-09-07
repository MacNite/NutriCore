/**
 * The demo: the application's own screens, on a fixture.
 *
 * Everything here is the markup the product renders. `Today` is the diary with
 * its energy ring, its four meal dialogs, its activities row and its
 * micronutrient panel; `Foods` is the search screen; `Progress` is the body and
 * nutrition chart. The classes are the application's classes and the stylesheet
 * is the application's stylesheet, so this page is what a reader would see
 * after signing in - with `demo-data.mjs` where the database would be.
 *
 * Two rules keep it honest. Nothing is styled here that the application does
 * not style: the only page-specific CSS is the banner and the three
 * affordances a page without a server needs. And nothing states a number the
 * fixture does not contain: the totals, the meal shares, the remaining energy
 * and the coverage bars are all computed from the entries below, the way
 * src/server/diary.ts computes them from rows.
 */
import {
  MEALS,
  days,
  energySeries,
  profile,
  proposals,
  recentFoods,
  recipes,
  searchIndex,
  weightSeries,
} from "../demo-data.mjs";
import { facts, formatDate, formatKcal, formatNumber, formatNutrient, formatPercent, micronutrientCatalogue, num, t } from "../data.mjs";
import { SCREENS, appPage } from "../app-frame.mjs";

/* --- The application's own small helpers ---------------------------------- */

/** src/components/source-badge.tsx: provenance as text, never as colour alone. */
const BADGE_CLASS = {
  OPEN_FOOD_FACTS: "badge-off",
  USDA: "badge-usda",
  BLS: "badge-bls",
  USER: "badge-user",
  RECIPE: "badge-recipe",
  AI_RESEARCH: "badge-ai",
};

const SOURCE_FALLBACK = { OPEN_FOOD_FACTS: "OFF", USDA: "USDA", BLS: "BLS", USER: "My food", RECIPE: "Recipe", AI_RESEARCH: "AI estimate" };

const badge = (source) => {
  const label = t(`foods.source.${source}`, {}, SOURCE_FALLBACK[source] ?? source);
  const full = t(`foods.sourceFull.${source}`, {}, label);
  return `<span class="badge ${BADGE_CLASS[source] ?? ""}" title="${full}">${label}<span class="sr-only"> — ${full}</span></span>`;
};

/** src/lib/meal-splits.ts, remainder handed out by largest fractional part. */
function mealTargets(dailyKcal, split) {
  if (dailyKcal === null) return null;
  const exact = MEALS.map((meal) => ({ meal, value: (dailyKcal * split[meal]) / 100 }));
  const floors = exact.map((entry) => ({ ...entry, floor: Math.floor(entry.value) }));
  let remainder = Math.round(dailyKcal) - floors.reduce((sum, entry) => sum + entry.floor, 0);
  const bonus = new Set();
  for (const entry of [...floors]
    .filter((entry) => split[entry.meal] > 0)
    .sort((a, b) => b.value - b.floor - (a.value - a.floor) || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal))) {
    if (remainder <= 0) break;
    bonus.add(entry.meal);
    remainder -= 1;
  }
  return Object.fromEntries(floors.map((entry) => [entry.meal, entry.floor + (bonus.has(entry.meal) ? 1 : 0)]));
}

const entriesOf = (day) => MEALS.flatMap((meal) => day.meals[meal] ?? []);
const sum = (entries, key) => entries.reduce((total, entry) => total + (entry[key] ?? 0), 0);

/** `targetWithActivity`: the day's allowance includes what was moved that day. */
const dayTarget = (day) => profile.target.kcal + (day.activity.totalActiveKcal ?? 0);

/** src/components/meal-total.tsx. A meal over its share is a hint, not a verdict. */
function mealTotal(kcal, target) {
  const consumed = kcal === null ? "–" : formatKcal(kcal);
  if (target === null) return kcal === null ? "–" : `${consumed} ${t("common.kcal", {}, "kcal")}`;
  const over = kcal !== null && kcal > target;
  const label = over ? t("diary.mealOver", { amount: formatKcal(kcal - target) }, `${formatKcal(kcal - target)} kcal over`) : null;
  return `<span class="${over ? "meal-total over" : "meal-total"}"${label ? ` title="${label}"` : ""}>${consumed} / ${formatKcal(target)} ${t("common.kcal", {}, "kcal")}${label ? `<span class="sr-only"> (${label})</span>` : ""}</span>`;
}

/* --- Today ---------------------------------------------------------------- */

/** src/components/daily-energy-summary.tsx, ring and three macro bars. */
function energyCard(day, index) {
  const entries = entriesOf(day);
  const consumed = sum(entries, "kcal");
  const target = dayTarget(day);
  const remaining = target - consumed;
  const fraction = Math.min(consumed / target, 1);

  const macro = (label, value, goal, variant) => `
        <div class="macro">
          <div class="macro-head">
            <span>${label}</span>
            <strong>${formatNumber(value, 0)} / ${formatNumber(goal, 0)} g</strong>
          </div>
          <div class="bar${variant ? ` ${variant}` : ""}"><i style="width:${((Math.min(value / goal, 1)) * 100).toFixed(1)}%"></i></div>
        </div>`;

  return `
      <section class="card" aria-labelledby="energy-heading-${index}">
        <h2 id="energy-heading-${index}" class="sr-only">${t("today.consumed", { consumed: formatKcal(consumed), target: formatKcal(target) }, `${formatKcal(consumed)} of ${formatKcal(target)} kcal`)}</h2>
        <div class="energy">
          <div class="ring" style="--progress:${(fraction * 100).toFixed(1)}%" role="img"
               aria-label="${t("today.energyRing", {}, "Energy consumed compared with the daily target")} ${formatPercent(fraction)}">
            <div class="ring-text">${formatKcal(consumed)}<small>${t("common.of", {}, "of")} ${formatKcal(target)} ${t("common.kcal", {}, "kcal")}</small></div>
          </div>
          <div>${macro(t("target.protein", {}, "Protein"), sum(entries, "protein"), profile.target.protein)}${macro(
            t("target.carbohydrate", {}, "Carbohydrates"),
            sum(entries, "carbohydrate"),
            profile.target.carbohydrate,
            "carb",
          )}${macro(t("target.fat", {}, "Fat"), sum(entries, "fat"), profile.target.fat, "fat")}
            <p class="muted" style="margin:12px 0 0;font-size:13.5px">
              <strong style="color:var(--text)">${t("today.remaining", { amount: formatKcal(remaining) }, `${formatKcal(remaining)} kcal remaining`)}</strong>
            </p>
          </div>
        </div>
      </section>`;
}

/** src/components/diary-entry-row.tsx. The row reads the entry and leads to it. */
const entryRow = (entry) => `
            <div class="row clickable-row">
              <span class="row-main-link" data-demo-inert>
                <div class="row-body">
                  <strong>${entry.name}</strong>
                  <span>${entry.brand ? `${entry.brand} · ` : ""}${formatNumber(entry.quantity)} ${entry.unit}</span>
                </div>
                ${badge(entry.source)}
                <span class="row-value">${formatKcal(entry.kcal)} kcal</span>
              </span>
              <div class="row-actions">
                <button type="button" class="btn btn-quiet" data-demo-inert aria-label="${t("a11y.editEntry", { name: entry.name }, `Edit ${entry.name}`)}"><span aria-hidden="true">✎</span></button>
                <button type="button" class="btn btn-quiet" data-demo-inert aria-label="${t("a11y.removeEntry", { name: entry.name }, `Remove ${entry.name}`)}"><span aria-hidden="true">×</span></button>
              </div>
            </div>`;

/** A meal: the collapsed row, and the dialog it opens. */
function mealRow(day, meal, index, target) {
  const entries = day.meals[meal] ?? [];
  const kcal = entries.length ? sum(entries, "kcal") : null;
  const name = t(`diary.meals.${meal}`, {}, meal);
  const id = `meal-${meal.toLowerCase()}-${index}`;
  const total = mealTotal(kcal, target);
  const preview = entries.map((entry) => entry.name);

  return `
          <div class="row clickable-row">
            <button class="row-main-button" type="button" data-dialog="${id}">
              <div class="row-body">
                <strong>${name}</strong>
                <span>${preview.length === 0 ? t("diary.empty", {}, "Nothing logged yet") : preview.slice(0, 3).join(" · ")}</span>
              </div>
              <span class="row-value">${total}</span>
            </button>
            <button class="icon-btn" type="button" data-dialog="${id}" aria-label="${t("diary.addTo", { meal: name }, `Add to ${name}`)}"><span aria-hidden="true">＋</span></button>
          </div>
          <dialog class="app-dialog" id="${id}" aria-labelledby="${id}-title">
            <div class="app-dialog-head">
              <h2 id="${id}-title">${name}</h2>
              <button class="icon-btn" type="button" data-dialog-close aria-label="${t("common.close", {}, "Close")}"><span aria-hidden="true">×</span></button>
            </div>
            <div class="app-dialog-body">
              <div class="dialog-toolbar">
                <strong>${total}</strong>
                <div class="food-search-dropdown">
                  <div class="search-with-action">
                    <input class="meal-search-input" type="search" inputmode="search" autocomplete="off"
                           placeholder="${t("foods.searchPlaceholder", {}, "Search food / recipe or enter a barcode")}"
                           aria-label="${t("foods.searchPlaceholder", {}, "Search food / recipe or enter a barcode")}" data-meal-search />
                  </div>
                  <div class="food-search-panel" data-meal-search-panel hidden>
                    <p class="food-search-message">The demo's food search runs on the Foods screen, over the same fixture.</p>
                    <div class="food-search-actions">
                      <button type="button" class="btn btn-quiet" data-goto="foods">${t("today.searchFood", {}, "Search food")}</button>
                    </div>
                  </div>
                </div>
              </div>
              ${entries.length === 0 ? `<p class="empty">${t("diary.empty", {}, "Nothing logged yet")}</p>` : entries.map(entryRow).join("")}
            </div>
          </dialog>`;
}

/** src/components/micronutrient-summary.tsx, compact on the page and complete in the dialog. */
function microSummary(day, compact) {
  const shown = compact
    ? micronutrientCatalogue.filter((nutrient) => ["calcium", "iron", "magnesium", "potassium", "vitaminC", "vitaminD"].includes(nutrient.key))
    : micronutrientCatalogue;

  const item = (nutrient) => {
    const measured = day.micronutrients[nutrient.key] ?? null;
    const value = measured?.value ?? null;
    const coverage = measured?.coverage ?? null;
    const label = t("nutrients." + nutrient.key, {}, nutrient.name);
    const coverageLabel = coverage === null ? null : t("micronutrients.coverage", { percent: formatPercent(coverage) }, `${formatPercent(coverage)} of intake covered`);
    return `
            <div class="micro-item">
              <span>${label}</span>
              <strong>${value === null ? `<span aria-hidden="true">–</span><span class="sr-only">${t("common.unknown", {}, "Unknown")}</span>` : `${formatNutrient(value)} <small>${nutrient.unit}</small>`}</strong>
              ${coverage === null ? "" : `<progress class="micro-indicator" value="${Math.round(coverage * 100)}" max="100" aria-label="${coverageLabel}"></progress>`}
              ${coverage !== null && coverage < 1 ? `<small class="micro-coverage">${coverageLabel}</small>` : ""}
            </div>`;
  };

  return `
        <div class="micro-summary">
          <div class="micro-grid">${shown.map(item).join("")}
          </div>
          <p class="micro-hint">${t("micronutrients.hint", {}, "A dash means that no values are available for the foods you logged.")}</p>
        </div>`;
}

function activitiesRow(day, index) {
  const id = `activities-${index}`;
  const total = day.activity.totalActiveKcal;
  const preview = day.activity.entries.map((entry) => entry.name);

  return `
      <section class="card">
        <div class="row clickable-row">
          <button class="row-main-button" type="button" data-dialog="${id}">
            <div class="row-body">
              <strong>${t("activity.title", {}, "Sport & Activity")}</strong>
              <span>${preview.length === 0 ? t("activity.empty", {}, "No activity logged yet.") : preview.slice(0, 3).join(" · ")}</span>
            </div>
            <span class="row-value">${total === null ? "–" : `${formatKcal(total)} ${t("common.kcal", {}, "kcal")}`}</span>
          </button>
          <button class="icon-btn" type="button" data-dialog="${id}" aria-label="${t("activity.addLabel", {}, "Add activity")}"><span aria-hidden="true">＋</span></button>
        </div>
        <dialog class="app-dialog" id="${id}" aria-labelledby="${id}-title">
          <div class="app-dialog-head">
            <h2 id="${id}-title">${t("activity.title", {}, "Sport & Activity")}</h2>
            <button class="icon-btn" type="button" data-dialog-close aria-label="${t("common.close", {}, "Close")}"><span aria-hidden="true">×</span></button>
          </div>
          <div class="app-dialog-body">
            ${day.activity.entries.length === 0
              ? `<p class="empty">${t("activity.empty", {}, "No activity logged yet.")}</p>`
              : day.activity.entries
                  .map(
                    (entry) => `
            <div class="row">
              <div class="row-body"><strong>${entry.name}</strong><span>${entry.detail}</span></div>
              <span class="row-value">${formatKcal(entry.activeKcal)} ${t("common.kcal", {}, "kcal")}</span>
            </div>`,
                  )
                  .join("")}
            <div class="activity-total">
              <strong>${t("activity.activeCalories", {}, "Estimated active calories")}</strong>
              <strong>${total === null ? "–" : `${formatKcal(total)} ${t("common.kcal", {}, "kcal")}`}</strong>
            </div>
          </div>
        </dialog>
      </section>`;
}

/** One day of the diary: everything on Today that changes when the date does. */
function dayStack(day, index) {
  const target = mealTargets(dayTarget(day), profile.mealSplit);
  const microId = `micronutrients-${index}`;

  return `
    <div class="stack" data-day="${day.date}" data-day-weekday="${day.weekday}"${index === 0 ? "" : " hidden"}>
      <p class="muted demo-day-label" hidden>${day.label}</p>
      ${energyCard(day, index)}

      <section class="card" aria-labelledby="meals-heading-${index}">
        <div class="card-head"><h2 id="meals-heading-${index}">${t("diary.title", {}, "Diary")}</h2></div>
        ${MEALS.map((meal) => mealRow(day, meal, index, target[meal])).join("")}
      </section>

      ${activitiesRow(day, index)}

      <section class="card" aria-labelledby="micro-heading-${index}">
        <div class="card-head">
          <h2 id="micro-heading-${index}">${t("diary.micronutrients", {}, "Micronutrients")}</h2>
          <button class="btn btn-quiet" type="button" data-dialog="${microId}">${t("today.allMicronutrients", {}, "View all")}</button>
        </div>
        ${microSummary(day, true)}
        <dialog class="app-dialog" id="${microId}" aria-labelledby="${microId}-title">
          <div class="app-dialog-head">
            <h2 id="${microId}-title">${t("diary.micronutrients", {}, "Micronutrients")}</h2>
            <button class="icon-btn" type="button" data-dialog-close aria-label="${t("common.close", {}, "Close")}"><span aria-hidden="true">×</span></button>
          </div>
          <div class="app-dialog-body">${microSummary(day, false)}</div>
        </dialog>
      </section>
    </div>`;
}

/** src/components/pending-proposals.tsx: an AI proposal is never logged unasked. */
const pendingCard = `
      <section class="card" aria-labelledby="pending-ai-heading">
        <div class="card-head">
          <div>
            <h2 id="pending-ai-heading"><span class="ai-badge">AI</span> ${t("aiReview.pendingHeading", {}, "Waiting for your approval")}</h2>
            <p class="muted" style="margin:0">${t("aiReview.pendingIntro", {}, "Accepting logs the matches below to the diary.")}</p>
          </div>
        </div>
        <ul class="plain-list">
          ${proposals
            .map(
              (proposal) => `
          <li class="pending-proposal">
            <div>
              <strong>${proposal.text}</strong><br />
              <span class="muted">${proposal.summary}</span>
              ${proposal.skipped.length ? `<br /><span class="muted">${t("aiReview.skippedShort", {}, "Not logged:")} ${proposal.skipped.join(", ")}</span>` : ""}
            </div>
            <div class="pending-actions">
              <button class="btn btn-primary" type="button" data-demo-inert><span aria-hidden="true">✓</span> ${t("aiReview.acceptNow", {}, "Accept")}</button>
              <button class="btn btn-quiet" type="button" data-demo-inert>${t("aiReview.reject", {}, "Reject")}</button>
              <button class="btn btn-quiet" type="button" data-demo-inert>${t("aiReview.openReview", {}, "Review")}</button>
            </div>
          </li>`,
            )
            .join("")}
        </ul>
      </section>`;

const vitaminCCoverage = days[0].micronutrients.vitaminC?.coverage ?? null;

const todayScreen = `
<div data-screen-panel="today" id="today">
  <div class="page-head">
    <div>
      <h1>${t("today.greeting", { name: profile.name.split(" ")[0] }, `Hello, ${profile.name.split(" ")[0]}`)}</h1>
      <p class="muted" style="margin:0">${t("today.subtitle", {}, "A balanced day starts with clarity.")}</p>
    </div>
    <nav class="date-nav" aria-label="${t("diary.title", {}, "Diary")}">
      <button class="btn btn-quiet" type="button" data-day-step="-1" aria-label="${t("diary.previousDay", {}, "Previous day")}"><span aria-hidden="true">‹</span></button>
      <strong data-day-label>${days[0].weekday}</strong>
      <button class="btn btn-quiet" type="button" data-day-step="1" aria-label="${t("diary.nextDay", {}, "Next day")}"><span aria-hidden="true">›</span></button>
    </nav>
  </div>

  ${pendingCard}

  <div class="grid-main" style="margin-top:20px">
    <div class="stack">
      ${days.map(dayStack).join("\n")}
    </div>

    <aside class="stack">
      <section class="card" aria-labelledby="quick-heading">
        <h2 id="quick-heading">${t("today.quickAdd", {}, "Quick add")}</h2>
        <div class="quick-grid">
          <button class="btn" type="button" data-goto="foods"><span aria-hidden="true">⌕</span>${t("today.searchFood", {}, "Search food")}</button>
          <button class="btn" type="button" data-demo-inert><span aria-hidden="true">▤</span>${t("today.scanBarcode", {}, "Barcode")}</button>
          <button class="btn" type="button" data-demo-inert><span aria-hidden="true">＋</span>${t("common.add", {}, "Add")}</button>
        </div>
        <div class="copy-previous-action">
          <button class="btn btn-quiet" type="button" data-demo-inert><span aria-hidden="true">⧉</span> ${t("diary.copyPreviousDay", {}, "Copy yesterday")}</button>
        </div>
        ${vitaminCCoverage === null ? "" : `
        <div class="notice${vitaminCCoverage < 0.75 ? " notice-warn" : ""}" style="margin-top:14px">
          <span class="notice-icon" aria-hidden="true">ⓘ</span>
          <span>
            ${t("today.coverage", { nutrient: t("nutrients.vitaminC", {}, "Vitamin C"), percent: formatPercent(vitaminCCoverage) }, `Vitamin C coverage today: ${formatPercent(vitaminCCoverage)}`)}<br />
            <span class="muted">${t("today.coverageHint", {}, "Missing values are not counted as zero.")}</span>
          </span>
        </div>`}
      </section>

      <section class="card" aria-labelledby="recent-heading">
        <h2 id="recent-heading">${t("today.recent", {}, "Recently used")}</h2>
        ${recentFoods
          .map(
            (food) => `
        <div class="row">
          <div class="row-body">
            <strong>${food.name}</strong>
            <span>${food.brand ? `${food.brand} · ` : ""}${formatNumber(food.quantity)} ${food.unit}</span>
          </div>
          ${badge(food.source)}
          <button class="btn btn-primary add-food-button" type="button" data-demo-inert aria-label="${t("a11y.addFood", {}, "Add food")}"><span aria-hidden="true">＋</span></button>
        </div>`,
          )
          .join("")}
      </section>
    </aside>
  </div>
</div>`;

/* --- Foods ---------------------------------------------------------------- */

const foodRow = (food, recent) => `
      <div class="row clickable-row" data-food="${(food.name + " " + (food.brand ?? "")).toLowerCase()}"${recent ? "" : " hidden"}>
        <span class="row-main-link" data-demo-inert>
          <div class="row-body">
            <strong>${food.name}</strong>
            <span>${food.brand ? `${food.brand} · ` : ""}${formatKcal(food.kcal)} kcal ${t("foods.perBasis", { amount: formatNumber(food.basis, 0), unit: food.basisUnit }, `per ${food.basis} ${food.basisUnit}`)}</span>
          </div>
          ${badge(food.source)}
        </span>
        <button class="btn btn-primary add-food-button" type="button" data-demo-inert aria-label="${t("foods.servingLabel", {}, "Serving")}"><span aria-hidden="true">＋</span></button>
      </div>`;

/** The five foods the diary used last are what the screen opens on. */
const recentNames = new Set(recentFoods.map((food) => food.name));

const foodsScreen = `
<div data-screen-panel="foods" id="foods" hidden>
  <div class="page-head">
    <div>
      <h1>${t("foods.title", {}, "Foods")}</h1>
      <p class="muted" style="margin:0">${t("foods.searchHint", {}, "Typing searches only NutriCore’s local database.")}</p>
    </div>
  </div>

  <section class="card" style="margin-bottom:20px">
    <div class="field" style="margin-bottom:0">
      <label for="food-query">${t("foods.searchPlaceholder", {}, "Search food / recipe or enter a barcode")}</label>
      <div class="search-with-action">
        <input id="food-query" type="search" inputmode="search" autocomplete="off"
               placeholder="${t("foods.searchPlaceholder", {}, "Search food / recipe or enter a barcode")}"
               aria-describedby="food-query-status" data-food-search />
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
      <button type="button" class="btn btn-quiet" data-demo-inert>${t("foods.searchExternal", {}, "Search Open Food Facts")}</button>
      <span id="food-query-status" role="status" aria-live="polite" class="muted" style="font-size:13px" data-food-status></span>
    </div>
  </section>

  <section class="card">
    <h2 data-food-recent-heading>${t("foods.recentlyUsed", {}, "Recently used")}</h2>
    <div class="recent-food-list" data-food-list>
      ${searchIndex.map((food) => foodRow(food, recentNames.has(food.name))).join("")}
    </div>
    <div class="empty" data-food-empty hidden>
      <p style="margin:0 0 6px">${t("foods.noResults", {}, "No matching food found.")}</p>
      <p class="muted" style="margin:0 0 14px">${t("foods.noResultsHint", {}, "You can create the food yourself or start an AI research request.")}</p>
      <button class="btn btn-primary" type="button" data-demo-inert>${t("foods.createCustom", {}, "Create food")}</button>
    </div>
  </section>

  <section class="card" style="margin-top:20px" aria-labelledby="recipes-heading">
    <div class="card-head">
      <div>
        <h2 id="recipes-heading">${t("recipes.title", {}, "Recipes")}</h2>
        <p class="muted" style="margin:0">${t("recipes.combinedHint", {}, "Foods and recipes live together so they are easier to find and log.")}</p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" type="button" data-demo-inert>${t("sharing.title", {}, "Shared recipes")}</button>
        <button class="btn btn-primary" type="button" data-demo-inert>${t("recipes.create", {}, "Create recipe")}</button>
      </div>
    </div>
    ${recipes
      .map(
        (recipe) => `
    <div class="row">
      <div class="row-body">
        <strong>${recipe.name}</strong>
        <span>${recipe.ingredients} ingredients</span>
      </div>
    </div>`,
      )
      .join("")}
  </section>
</div>`;

/* --- Progress -------------------------------------------------------------
   One chart on one date domain, the way the body section plots measurements
   and nutrition together: weight against its seven-day mean, and the energy of
   each day against the target. The chips switch a series off, which is the one
   interaction the real chart has that a fixture can honestly keep. */

const WIDTH = 720;
const HEIGHT = 260;
const PAD = { left: 40, right: 46, top: 18, bottom: 30 };

const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;
const domain = { from: dayNumber(weightSeries[0].date), to: dayNumber(weightSeries[weightSeries.length - 1].date) };
const x = (date) => PAD.left + ((dayNumber(date) - domain.from) / (domain.to - domain.from)) * (WIDTH - PAD.left - PAD.right);

const weightMin = Math.floor(Math.min(...weightSeries.map((point) => point.kg)) - 1);
const weightMax = Math.ceil(Math.max(...weightSeries.map((point) => point.kg)) + 1);
const yWeight = (kg) => PAD.top + ((weightMax - kg) / (weightMax - weightMin)) * (HEIGHT - PAD.top - PAD.bottom);

const energyMax = 3000;
const yEnergy = (kcal) => PAD.top + ((energyMax - kcal) / energyMax) * (HEIGHT - PAD.top - PAD.bottom);

/** The mean of every measurement within the preceding week, point by point. */
const weightTrend = weightSeries.map((point, index) => {
  const window = weightSeries.slice(0, index + 1).filter((other) => dayNumber(point.date) - dayNumber(other.date) <= 7);
  return { date: point.date, kg: window.reduce((total, other) => total + other.kg, 0) / window.length };
});

const line = (points, value) =>
  points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.date).toFixed(1)} ${value(point).toFixed(1)}`).join(" ");

const latestWeight = weightSeries[weightSeries.length - 1];
const weightChange = latestWeight.kg - weightSeries[0].kg;
const averageEnergy = energySeries.reduce((total, point) => total + point.kcal, 0) / energySeries.length;
const daysUnderTarget = energySeries.filter((point) => point.kcal <= profile.target.kcal).length;

const progressScreen = `
<div data-screen-panel="progress" id="progress" hidden>
  <div class="page-head">
    <div>
      <h1>${t("progress.title", {}, "Progress")}</h1>
      <p class="muted" style="margin:0">${t("progress.dayToDayNote", {}, "Day-to-day changes are mostly water. The trend line matters more.")}</p>
    </div>
  </div>

  <div class="grid-main">
    <div class="stack">
      <section class="card" aria-labelledby="series-heading">
        <h2 id="series-heading">${t("progress.weight", {}, "Weight")} &amp; ${t("progress.nutrition.calories", {}, "Calories")}</h2>
        <p class="muted nutrition-subtitle">Weight against its seven-day mean, and each day's energy against the target.</p>

        <div class="progress-filters" role="group" aria-label="${t("progress.nutrition.selectNutrients", {}, "Displayed nutrients")}">
          <button type="button" class="progress-chip" aria-pressed="true" data-series="weight"><span class="series-mark" style="background:var(--accent)" aria-hidden="true"></span>${t("progress.weight", {}, "Weight")}</button>
          <button type="button" class="progress-chip" aria-pressed="true" data-series="trend"><span class="series-mark" style="background:var(--fat)" aria-hidden="true"></span>${t("progress.trend", {}, "7-day average")}</button>
          <button type="button" class="progress-chip" aria-pressed="true" data-series="energy"><span class="series-mark" style="background:var(--carb)" aria-hidden="true"></span>${t("progress.nutrition.calories", {}, "Calories")}</button>
        </div>

        <p class="progress-score">
          <span>${daysUnderTarget} of ${energySeries.length} days at or below the target</span>
          <span>${formatKcal(averageEnergy)} ${t("common.kcal", {}, "kcal")} on average</span>
        </p>

        <figure class="nutrition-chart">
          <div class="table-scroll">
            <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" height="${HEIGHT}" role="img" style="min-width:340px;display:block"
                 aria-label="Weight from ${formatNumber(weightSeries[0].kg, 1)} to ${formatNumber(latestWeight.kg, 1)} kilograms between ${formatDate(weightSeries[0].date)} and ${formatDate(latestWeight.date)}, and the energy logged on each of the last ${energySeries.length} days against a target of ${formatKcal(profile.target.kcal)} kilocalories">
              ${[0, 0.25, 0.5, 0.75, 1]
                .map((fraction) => {
                  const y = PAD.top + (1 - fraction) * (HEIGHT - PAD.top - PAD.bottom);
                  return `<g>
                <line x1="${PAD.left}" x2="${WIDTH - PAD.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1" />
                <text x="4" y="${(y + 4).toFixed(1)}" font-size="11" fill="var(--text-muted)">${formatNumber(weightMin + fraction * (weightMax - weightMin), 1)}${fraction === 0 ? " kg" : ""}</text>
                <text x="${WIDTH - 4}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--text-muted)">${formatKcal(fraction * energyMax)}${fraction === 0 ? " kcal" : ""}</text>
              </g>`;
                })
                .join("\n              ")}

              <g data-series-mark="energy">
                ${energySeries
                  .map((point) => {
                    const barWidth = 18;
                    const top = yEnergy(point.kcal);
                    return `<rect x="${(x(point.date) - barWidth / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barWidth}" height="${(HEIGHT - PAD.bottom - top).toFixed(1)}" rx="3" fill="var(--carb)" opacity="0.42" />`;
                  })
                  .join("\n                ")}
                <line x1="${PAD.left}" x2="${WIDTH - PAD.right}" y1="${yEnergy(profile.target.kcal).toFixed(1)}" y2="${yEnergy(profile.target.kcal).toFixed(1)}" stroke="var(--carb)" stroke-width="2" stroke-dasharray="6 4" />
                <text x="${WIDTH - PAD.right}" y="${(yEnergy(profile.target.kcal) - 7).toFixed(1)}" text-anchor="end" font-size="11" font-weight="600" fill="var(--carb)">${t("progress.nutrition.targetLine", {}, "Daily target")}</text>
              </g>

              <g data-series-mark="trend">
                <path d="${line(weightTrend, (point) => yWeight(point.kg))}" fill="none" stroke="var(--fat)" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round" />
              </g>

              <g data-series-mark="weight">
                <path d="${line(weightSeries, (point) => yWeight(point.kg))}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
                ${weightSeries
                  .map((point) => `<circle cx="${x(point.date).toFixed(1)}" cy="${yWeight(point.kg).toFixed(1)}" r="3.5" fill="var(--accent)" />`)
                  .join("\n                ")}
              </g>

              <text x="${PAD.left}" y="${HEIGHT - 8}" font-size="11" fill="var(--text-muted)">${formatDate(weightSeries[0].date)}</text>
              <text x="${WIDTH - PAD.right}" y="${HEIGHT - 8}" text-anchor="end" font-size="11" fill="var(--text-muted)">${formatDate(latestWeight.date)}</text>
            </svg>
          </div>
          <figcaption class="chart-detail">
            <strong>${formatNumber(latestWeight.kg, 1)} kg</strong>
            <span>${formatNumber(weightChange, 1)} kg since ${formatDate(weightSeries[0].date)} · ${t("progress.nutrition.interactionHint", {}, "Touch or focus a data point to show consumption and target.")}</span>
          </figcaption>
        </figure>
      </section>

      <section class="card" aria-labelledby="figures-heading">
        <h2 id="figures-heading">${t("progress.entries", { count: weightSeries.length }, `Entries (${weightSeries.length})`)}</h2>
        ${[
          { label: t("progress.weight", {}, "Weight"), detail: formatDate(latestWeight.date), value: `${formatNumber(latestWeight.kg, 1)} kg` },
          { label: t("progress.trend", {}, "7-day average"), detail: `${weightSeries.length} measurements`, value: `${formatNumber(weightTrend[weightTrend.length - 1].kg, 1)} kg` },
          { label: t("progress.nutrition.calories", {}, "Calories"), detail: `${energySeries.length} days`, value: `${formatKcal(averageEnergy)} ${t("common.kcal", {}, "kcal")}` },
          { label: t("target.final", {}, "Active target"), detail: profile.basis, value: `${formatKcal(profile.target.kcal)} ${t("common.kcal", {}, "kcal")}` },
        ]
          .map(
            (figure) => `
        <div class="row">
          <div class="row-body"><strong>${figure.label}</strong><span>${figure.detail}</span></div>
          <span class="row-value">${figure.value}</span>
        </div>`,
          )
          .join("")}
      </section>
    </div>

    <aside class="stack">
      <section class="card">
        <h2>${t("bodyProgress.checkin.title", {}, "Body check-in")}</h2>
        <p class="muted" style="margin:0 0 14px">${t("bodyProgress.checkin.intro", {}, "Enter what you measured.")}</p>
        <span class="body-checkin-actions">
          <button class="btn btn-primary" type="button" data-demo-inert>${t("bodyProgress.checkin.open", {}, "Body check-in")}</button>
          <button class="btn" type="button" data-demo-inert>${t("bodyScan.capture.title", {}, "Body scan")}</button>
        </span>
      </section>
    </aside>
  </div>
</div>`;

/* --- The floating action button ------------------------------------------- */

const fab = `
<div class="fab-stack">
  <div class="fab-menu" role="group" aria-label="${t("quickActions.menu", {}, "Quick entries")}" data-fab-menu hidden>
    <button class="fab-action" type="button" data-demo-inert><span class="fab-action-label">${t("quickActions.describeMeal", {}, "Describe a meal")}</span><span class="fab-action-icon" data-tone="meal" aria-hidden="true">✎</span></button>
    <button class="fab-action" type="button" data-demo-inert><span class="fab-action-label">${t("quickActions.createRecipe", {}, "Create recipe")}</span><span class="fab-action-icon" data-tone="recipe" aria-hidden="true">≡</span></button>
    <button class="fab-action" type="button" data-demo-inert><span class="fab-action-label">${t("quickActions.addActivity", {}, "Add sport / activity")}</span><span class="fab-action-icon" data-tone="activity" aria-hidden="true">⚡</span></button>
    <button class="fab-action" type="button" data-demo-inert><span class="fab-action-label">${t("quickActions.bodyCheckin", {}, "Body measurement")}</span><span class="fab-action-icon" data-tone="body" aria-hidden="true">⚖</span></button>
  </div>
  <button class="fab fab-toggle" type="button" aria-expanded="false" aria-label="${t("quickActions.open", {}, "Add an entry")}" data-fab-toggle><span aria-hidden="true">＋</span></button>
</div>`;

export const demo = appPage({
  title: "NutriCore demo — the application, on static data",
  description: `The NutriCore interface itself: the diary with its energy ring and meal dialogs, the food search across ${num(facts.foods.total)} bundled foods, and the progress chart. Static data, no server, nothing stored.`,
  screens: [todayScreen, foodsScreen, progressScreen].join("\n"),
  fab,
});

/** Named so the build can check that the demo still carries every screen. */
export const demoScreens = SCREENS.map((screen) => screen.id);
