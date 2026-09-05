/**
 * The overview page.
 *
 * Every claim below is answerable from a file in this repository, and the file
 * is named next to the claim. That is deliberate: the interesting thing about
 * NutriCore is not that it tracks meals, it is *how* each number it shows was
 * arrived at, so the page is written as a tour of decisions rather than a list
 * of benefits.
 */
import { facts, num } from "../data.mjs";
import { page } from "../layout.mjs";

const heroPanel = `
<div class="panel" data-reveal>
  <div class="panel-head">
    <span class="lights"><i></i><i></i><i></i></span>
    <span>diary &mdash; today</span>
  </div>
  <div class="panel-body">
    <div class="summary" style="border:0;background:transparent;padding:0">
      <div class="ring" style="--progress:78.4%" role="img" aria-label="1,884 of 2,404 kilocalories logged">
        <div class="ring-text">1.884<small>kcal</small></div>
      </div>
      <div class="summary-macros">
        <div class="macro">
          <div class="macro-head"><span>Protein</span><strong>128 / 150 g</strong></div>
          <div class="bar"><i style="width:85%"></i></div>
        </div>
        <div class="macro">
          <div class="macro-head"><span>Kohlenhydrate</span><strong>171 / 240 g</strong></div>
          <div class="bar carb"><i style="width:71%"></i></div>
        </div>
        <div class="macro">
          <div class="macro-head"><span>Fett</span><strong>62 / 80 g</strong></div>
          <div class="bar fat"><i style="width:78%"></i></div>
        </div>
      </div>
    </div>
    <div class="meal-group">
      <div class="meal-head"><h3>Mittagessen</h3><span>642 kcal</span></div>
      <div class="entry-row">
        <div>
          <div class="entry-name">Linsen, rot, gekocht <span class="badge badge-bls">BLS</span></div>
          <div class="entry-sub">180 g &middot; C-0-1-2</div>
        </div>
        <div class="entry-kcal">208<small>kcal</small></div>
      </div>
      <div class="entry-row">
        <div>
          <div class="entry-name">Olivenöl <span class="badge badge-usda">USDA</span></div>
          <div class="entry-sub">12 g &middot; 1 EL</div>
        </div>
        <div class="entry-kcal">106<small>kcal</small></div>
      </div>
      <div class="entry-row">
        <div>
          <div class="entry-name">Vollkornbrot <span class="badge badge-off">OFF</span> <span class="badge badge-est">geschätzt</span></div>
          <div class="entry-sub">2 Scheiben &middot; 90 g</div>
        </div>
        <div class="entry-kcal">328<small>kcal</small></div>
      </div>
    </div>
  </div>
</div>`;

/* --- Diagrams -------------------------------------------------------------
   Drawn rather than screenshotted, so they inherit the page's theme and stay
   legible at any width. Each one describes a mechanism that actually exists in
   the source tree, and the caption names the file it describes. */

const datasetDiagram = `
<svg class="diagram" viewBox="0 0 560 150" role="img" aria-label="Upstream downloads are converted into checksummed artifacts, which are imported into PostgreSQL">
  <g class="label-sm">
    <rect class="box" x="0" y="26" width="150" height="90" rx="10" />
    <text x="14" y="48" class="label-strong">datasets/raw</text>
    <text x="14" y="70">BLS_4_0.xlsx &#183; 14 MB</text>
    <text x="14" y="86">FoodData_Central</text>
    <text x="14" y="102">291 MB &#183; build input</text>

    <rect class="box" x="200" y="14" width="164" height="114" rx="10" />
    <text x="214" y="36" class="label-strong">datasets/bundled</text>
    <text x="214" y="58">bls-4.0.ndjson.gz</text>
    <text x="214" y="74">usda-*.ndjson.gz</text>
    <text x="214" y="90">manifest.json</text>
    <text x="214" y="112">sha256 per artifact</text>

    <rect class="box box-accent" x="414" y="34" width="146" height="74" rx="10" />
    <text x="428" y="58" class="label-strong">PostgreSQL</text>
    <text x="428" y="80">${num(facts.foods.total)} foods</text>
    <text x="428" y="96">idempotent import</text>
  </g>
  <path class="flow" d="M154 71 H194" marker-end="url(#a1)" />
  <path class="flow flow-accent" d="M368 71 H408" marker-end="url(#a2)" />
  <text class="label-sm" x="158" y="62">convert</text>
  <text class="label-sm" x="372" y="62">import</text>
  <defs>
    <marker id="a1" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7z" fill="var(--rule-strong)" /></marker>
    <marker id="a2" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7z" fill="var(--jade)" /></marker>
  </defs>
</svg>`;

const tierDiagram = `
<svg class="diagram" viewBox="0 0 560 216" role="img" aria-label="Search asks each source in tier order and stops on the first sufficient candidate">
  <g>
    <rect class="box box-accent" x="0" y="6" width="172" height="44" rx="9" />
    <text class="label-strong" x="14" y="26">LOCAL</text>
    <text class="label-sm" x="14" y="41">own foods, recipes, cache</text>

    <rect class="box box-accent" x="0" y="58" width="172" height="44" rx="9" />
    <text class="label-strong" x="14" y="78">BLS &#183; USDA</text>
    <text class="label-sm" x="14" y="93">bundled, no network</text>

    <rect class="box" x="0" y="110" width="172" height="44" rx="9" />
    <text class="label-strong" x="14" y="130">OPEN_FOOD_FACTS</text>
    <text class="label-sm" x="14" y="145">branded, over the network</text>

    <rect class="box" x="0" y="162" width="172" height="44" rx="9" />
    <text class="label-strong" x="14" y="182">FATSECRET</text>
    <text class="label-sm" x="14" y="197">optional, needs a key</text>
  </g>

  <path class="flow flow-accent" d="M86 50 V56 M86 102 V108 M86 154 V160" marker-end="url(#a3)" />

  <rect class="box" x="226" y="62" width="186" height="98" rx="10" />
  <text class="label-strong" x="240" y="86">isSufficientCandidate</text>
  <text class="label-sm" x="240" y="108">strongMatch</text>
  <text class="label-sm" x="240" y="124">&#8743; completeness &#8805; 0.75</text>
  <text class="label-sm" x="240" y="146">else: ask the next tier</text>

  <path class="flow" d="M176 111 H220" marker-end="url(#a3)" />
  <path class="flow flow-accent" d="M416 111 H452" marker-end="url(#a3)" />
  <text class="label-strong" x="458" y="104">stop</text>
  <text class="label-sm" x="458" y="120">no further</text>
  <text class="label-sm" x="458" y="134">source is asked</text>
  <defs>
    <marker id="a3" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7z" fill="var(--jade)" /></marker>
  </defs>
</svg>`;

const aiDiagram = `
<svg class="diagram" viewBox="0 0 560 180" role="img" aria-label="An AI job is resolved against the food database and becomes a proposal that a person approves before anything is written">
  <g>
    <rect class="box" x="0" y="8" width="132" height="56" rx="9" />
    <text class="label-strong" x="14" y="32">Input</text>
    <text class="label-sm" x="14" y="50">photo &#183; text &#183; URL</text>

    <rect class="box" x="164" y="8" width="152" height="56" rx="9" />
    <text class="label-strong" x="178" y="32">Worker</text>
    <text class="label-sm" x="178" y="50">Ollama on your LAN</text>

    <rect class="box" x="348" y="8" width="172" height="56" rx="9" />
    <text class="label-strong" x="362" y="32">Resolver</text>
    <text class="label-sm" x="362" y="50">names &#8594; known foods</text>

    <rect class="box box-accent" x="164" y="112" width="356" height="58" rx="10" />
    <text class="label-strong" x="178" y="136">AiProposal &#8212; awaiting review</text>
    <text class="label-sm" x="178" y="154">candidates, grams, confidence, warnings</text>

    <rect class="box box-accent" x="0" y="112" width="132" height="58" rx="10" />
    <text class="label-strong" x="14" y="136">Diary</text>
    <text class="label-sm" x="14" y="154">on approval only</text>
  </g>
  <path class="flow" d="M136 36 H158" marker-end="url(#a4)" />
  <path class="flow" d="M320 36 H342" marker-end="url(#a4)" />
  <path class="flow" d="M434 68 V106" marker-end="url(#a4)" />
  <path class="flow flow-accent" d="M160 141 H138" marker-end="url(#a5)" />
  <text class="label-sm" x="0" y="94">a person is on this arrow</text>
  <defs>
    <marker id="a4" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7z" fill="var(--rule-strong)" /></marker>
    <marker id="a5" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7z" fill="var(--jade)" /></marker>
  </defs>
</svg>`;

const scanDiagram = `
<svg class="diagram" viewBox="0 0 560 190" role="img" aria-label="A front breadth and a side depth at the same height define an ellipse whose perimeter is the estimated circumference">
  <g>
    <rect class="box" x="10" y="24" width="104" height="118" rx="34" />
    <path class="flow" d="M10 84 H114" stroke-dasharray="4 4" marker-start="url(#a6)" marker-end="url(#a6)" />
    <text class="label-strong" x="56" y="76">a</text>
    <text class="label-sm" x="10" y="162">FRONT &#8212; breadth</text>

    <rect class="box" x="156" y="24" width="58" height="118" rx="24" />
    <path class="flow" d="M156 84 H214" stroke-dasharray="4 4" marker-start="url(#a6)" marker-end="url(#a6)" />
    <text class="label-strong" x="182" y="76">b</text>
    <text class="label-sm" x="152" y="162">SIDE &#8212; depth</text>

    <ellipse class="box box-accent" cx="400" cy="84" rx="96" ry="50" />
    <path class="flow flow-accent" d="M304 84 H496" stroke-dasharray="4 4" />
    <path class="flow flow-accent" d="M400 34 V134" stroke-dasharray="4 4" />
    <text class="label-strong" x="392" y="76">a</text>
    <text class="label-strong" x="412" y="104">b</text>
    <text class="label-sm" x="304" y="162">CROSS-SECTION at a shared BODY_LANDMARK</text>
    <text class="label-sm" x="304" y="178">perimeter &#8776; Ramanujan(a, b) &#177; interval</text>
  </g>
  <defs>
    <marker id="a6" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><circle cx="3" cy="3" r="2" fill="var(--rule-strong)" /></marker>
  </defs>
</svg>`;

const nutrientFigure = `
<div class="figure" data-reveal>
  <div class="nutrient-grid">
    <div class="nutrient-row"><span>Energie</span><b>1.884 kcal</b></div>
    <div class="nutrient-row"><span>Protein</span><b>128 g</b></div>
    <div class="nutrient-row"><span>Ballaststoffe</span><b>34 g</b></div>
    <div class="nutrient-row"><span>Eisen</span><b>14,2 mg</b></div>
    <div class="nutrient-row"><span>Calcium</span><b>861 mg</b></div>
    <div class="nutrient-row"><span>Vitamin B12</span><b>2,9 &micro;g</b></div>
    <div class="nutrient-row"><span>Selen</span><b>48 &micro;g</b></div>
    <div class="nutrient-row"><span>Iod</span><b>112 &micro;g</b></div>
  </div>
  <div class="figure-caption">
    src/lib/nutrients.ts &mdash; ${facts.nutrients} rows across energy, macro,
    secondary, mineral and vitamin. ${facts.vitamins} vitamins,
    ${facts.minerals} minerals. A new nutrient is a new row; the schema does
    not move.
  </div>
</div>`;

const targetFigure = `
<div class="figure" data-reveal>
  <div style="font-family:var(--serif);font-size:clamp(1.05rem,2vw,1.35rem);line-height:1.7;letter-spacing:-0.01em">
    BMR = 10&#8239;<i>w</i> + 6,25&#8239;<i>h</i> &minus; 5&#8239;<i>a</i> + <i>s</i>
  </div>
  <p style="font-size:0.8rem;color:var(--ink-3);font-family:var(--mono);margin:0.5rem 0 1.2rem">
    Mifflin&ndash;St Jeor &middot; s = +5 male, &minus;161 female
  </p>
  <div class="nutrient-grid">
    <div class="nutrient-row"><span>SEDENTARY</span><b>&times; 1,2</b></div>
    <div class="nutrient-row"><span>LIGHT</span><b>&times; 1,375</b></div>
    <div class="nutrient-row"><span>MODERATE</span><b>&times; 1,55</b></div>
    <div class="nutrient-row"><span>ACTIVE</span><b>&times; 1,725</b></div>
    <div class="nutrient-row"><span>VERY_ACTIVE</span><b>&times; 1,9</b></div>
    <div class="nutrient-row"><span>LOSE / GAIN</span><b>&minus;400 / +300</b></div>
  </div>
  <div class="figure-caption">
    src/lib/calories.ts &mdash; an automatic adjustment never exceeds 500 kcal
    and an automatic target is never placed below 1.200 kcal. Pregnancy,
    breastfeeding and minors return medical-guidance-required instead of a
    number.
  </div>
</div>`;

const ownershipFigure = `
<div class="figure" data-reveal>
  <div class="chips" style="margin-bottom:1.1rem">
    <span class="chip chip-accent">Argon2id &#183; 19 MiB &#183; t=2</span>
    <span class="chip">SHA-256 session tokens</span>
    <span class="chip">Invite-only registration</span>
    <span class="chip">In-process rate limits</span>
    <span class="chip">SSRF guard on every fetch</span>
    <span class="chip">No telemetry</span>
  </div>
  <div class="code">
    <div class="code-head"><span>export</span><button class="copy" type="button" data-copy>Copy</button></div>
<pre><span class="c"># Everything you entered, in formats other tools read.</span>
<span class="p">GET</span> /api/export/json
<span class="p">GET</span> /api/export/diary.csv
<span class="p">GET</span> /api/export/weight.csv</pre>
  </div>
  <div class="figure-caption">
    src/lib/auth.ts, src/lib/url-guard.ts, src/app/api/export &mdash; the
    database is yours, and so is the door out of it.
  </div>
</div>`;

const freeFigure = `
<div class="figure" data-reveal>
  <div class="ledger">
    <div class="ledger-head">NutriCore &mdash; what it costs</div>
    <div class="ledger-row"><span>Licence fee</span><b>0,00 &euro;</b></div>
    <div class="ledger-row"><span>Subscription</span><b>0,00 &euro;</b></div>
    <div class="ledger-row"><span>Accounts with anyone</span><b>none</b></div>
    <div class="ledger-row"><span>Advertising</span><b>none</b></div>
    <div class="ledger-row"><span>Features behind a plan</span><b>none</b></div>
    <div class="ledger-row"><span>Telemetry events</span><b>0</b></div>
    <div class="ledger-row total"><span>Total</span><b>0,00 &euro;</b></div>
  </div>
  <div class="figure-caption">
    There is no billing code in this repository, because there is nothing to
    bill for. What it does cost is a machine to run it on, and the electricity
    to keep it there.
  </div>
</div>`;

const customFigure = `
<div class="figure" data-reveal>
  <div class="code">
    <div class="code-head"><span>.env</span><button class="copy" type="button" data-copy>Copy</button></div>
<pre><span class="c"># Every source is independent. Turn one off and</span>
<span class="c"># the search simply stops asking it.</span>
BLS_ENABLED=<span class="p">true</span>
USDA_ENABLED=<span class="p">true</span>
OPENFOODFACTS_ENABLED=<span class="p">false</span>
FATSECRET_ENABLED=<span class="p">false</span>

<span class="c"># Off until configured. Nothing is called before then.</span>
AI_ENABLED=<span class="p">false</span>
RESEARCH_ENABLED=<span class="p">false</span>

DEFAULT_LOCALE=<span class="s">de</span>
IMAGE_UPLOAD_MAX_MB=<span class="p">5</span>
INVITATION_EXPIRY_HOURS=<span class="p">72</span></pre>
  </div>
  <div class="figure-caption">
    ${facts.settings} documented settings in .env.example. Inside the
    application: an energy override, a personal goal for any nutrient in the
    catalogue, your own foods, servings, recipes and activities, language per
    account and a theme with the same three states this page has.
  </div>
</div>`;

const opsFigure = `
<div class="figure" data-reveal>
  <div class="stat-row" style="margin-top:0">
    <div class="stat"><b>${facts.tests}</b><span>unit &amp; integration test files</span></div>
    <div class="stat"><b>${facts.e2eSuites}</b><span>Playwright suites</span></div>
    <div class="stat"><b>${facts.models}</b><span>Prisma models</span></div>
    <div class="stat"><b>2</b><span>architectures on release tags</span></div>
  </div>
  <div class="figure-caption">
    .github/workflows/ci.yml runs lint, typecheck, unit tests, a production
    build, the end-to-end suite against a real PostgreSQL ${facts.postgresVersion},
    a full food-database import, and then repeats the import to prove it changed
    nothing.
  </div>
</div>`;

const entries = [
  {
    title: "Your server, your database, your data",
    lead: `NutriCore runs on hardware you own, against a PostgreSQL you own. There is no
      account with anyone, no telemetry, no analytics, and in the default configuration not one
      request leaves the container &mdash; the food databases it searches are already inside it.`,
    body: `The security work is the ordinary, boring kind: passwords hashed with Argon2id at OWASP
      parameters, session tokens random 256-bit values of which only a SHA-256 hash is stored, and
      registration by invitation after the first account. Scan images are discarded once the estimate
      exists. And the door out is a route, not a support request: the whole diary as JSON, or day and
      weight histories as CSV, whenever you want them.`,
    meta: [
      ["Hash", "Argon2id &middot; 19 MiB &middot; timeCost 2"],
      ["Sessions", "hashed at rest &mdash; a leaked table hands out nothing"],
      ["Outbound", "only the sources you switch on, when you search"],
    ],
    figure: ownershipFigure,
  },
  {
    title: "Nothing to buy, nobody to sign up with",
    lead: `No subscription, no advertising, no upsell, no feature held back behind a plan. There is
      no payment path in the codebase at all, because there is nothing to charge for: you install it,
      and it is yours.`,
    body: `That is not a pricing decision so much as a consequence of the shape. Software that runs on
      your machine and talks to your database has nobody to bill and nothing to monetise &mdash; there
      is no usage to meter, no profile to sell and no engagement to optimise. The honest caveat: a
      licence has not been chosen yet, so this is free to run rather than free software.`,
    meta: [
      ["Cost", "a machine you already have, plus its electricity"],
      ["Accounts", "yours, on your instance, invitation-only"],
      ["Licence", facts.license],
    ],
    figure: freeFigure,
    reverse: true,
  },
  {
    title: "Configured, not just decorated",
    lead: `${facts.settings} documented settings in one <code>.env</code>. Every food source can be
      switched off independently, the AI and the web research are off until you fill in an address, and
      the interface language, the upload ceiling and the invitation lifetime are all yours to set.`,
    body: `The personalisation goes further than a preferences screen usually does. The calculated
      energy target can be overridden outright, and <strong>any</strong> nutrient in the catalogue can
      carry a goal you set yourself &mdash; not just protein, carbohydrate and fat, but fibre, iron,
      iodine, whatever you are actually watching. Targets are versioned rather than replaced, so
      changing one keeps the history of what it used to be.`,
    meta: [
      ["File", ".env.example &middot; every setting documented in place"],
      ["Targets", "overrideKcal plus manualNutrients, keyed by catalogue key"],
      ["Yours", "own foods, servings, recipes, activities, aliases"],
    ],
    figure: customFigure,
  },
  {
    title: "The food database ships inside the image",
    lead: `BLS 4.0 &mdash; the German national nutrient database, ${num(facts.foods.bls.records)} generic
      foods across ${facts.foods.bls.components} components &mdash; plus USDA Foundation Foods and SR
      Legacy, ${num(facts.foods.usda.records)} more. They are converted once into gzipped NDJSON with a
      checksum per artifact, committed, and imported into PostgreSQL by a command that is safe to run
      twice.`,
    body: `A search for <strong>Haferflocken</strong> touches no network at all. That is not a cache
      warming up; it is the database being present. The 291 MB of upstream downloads the artifacts were
      generated from stay out of the image entirely.`,
    meta: [
      ["Source", "datasets/bundled &middot; scripts/convert-food-datasets.mjs"],
      ["Import", "npm run db:import:foods &mdash; idempotent, proven in CI"],
      ["Size", "about 5 MB of gzipped NDJSON in the runtime image"],
    ],
    figure: `<div class="figure" data-reveal>${datasetDiagram}<div class="figure-caption">Conversion is a build step, not a deployment step: an artifact under version control is diffable, checksummed and identical on every machine. src/server/food-datasets owns every semantic decision; the converter transcribes and nothing else.</div></div>`,
    reverse: true,
  },
  {
    title: "A search that knows when to stop asking",
    lead: `Sources are consulted in tier order &mdash; what you already have, then the bundled reference
      databases, then the network ones. The traversal stops on the first candidate that is both an
      identity match and complete enough to log.`,
    body: `Similarity is not enough, and it is the reason the rule is written down in one testable
      place: <em>Nutella</em> is 0.8 similar to a dozen BLS entries for nut spreads, so a similarity
      threshold would mean no German search ever reaches a branded product. Tier order decides who is
      <strong>asked</strong>; ranking decides how answers are <strong>ordered</strong>. The two are kept
      apart on purpose.`,
    meta: [
      ["Rule", "strong match &and; completeness &ge; 0.75"],
      ["Files", "src/server/food-search-policy.ts &middot; src/providers/food-sources.ts"],
      ["Effect", "how much network traffic one keystroke may cause"],
    ],
    figure: `<div class="figure" data-reveal>${tierDiagram}<div class="figure-caption">A weak BLS hit still falls through to Open Food Facts &mdash; that is the whole point of the completeness half of the rule. Tier order decides who is asked; src/lib/ranking.ts decides how the answers are ordered.</div></div>`,
  },
  {
    title: `${facts.nutrients} nutrients, held as a catalogue`,
    lead: `Energy, macros, the secondary values a label carries, ${facts.minerals} minerals and
      ${facts.vitamins} vitamins. Every value keeps the unit its source stated, and a food that simply
      does not state a nutrient shows a dash rather than a zero.`,
    body: `The catalogue is a list in one file, not a column layout. Adding iodine to the application
      means adding a row and re-running the seed &mdash; not a migration, not a schema change, not a
      backfill. It is also what makes a personal goal for any nutrient possible: the goals are keyed by
      the same catalogue key.`,
    meta: [
      ["File", "src/lib/nutrients.ts"],
      ["Categories", "energy &middot; macro &middot; secondary &middot; mineral &middot; vitamin"],
      ["Missing", "rendered as absent, never as zero"],
    ],
    figure: nutrientFigure,
    reverse: true,
  },
  {
    title: "Targets you can recompute by hand",
    lead: `Mifflin&ndash;St Jeor for basal rate, the standard activity multipliers, a conservative goal
      adjustment. Every intermediate value is kept, so the day's number can be traced back through the
      multiplier and the adjustment that produced it &mdash; or replaced outright with your own.`,
    body: `The guardrails are part of the calculation rather than a warning printed next to it: an
      automatic adjustment is capped at 500 kcal, an automatic target never falls below 1.200 kcal, and
      pregnancy, breastfeeding or an age outside the formula's population return
      <code>medical-guidance-required</code> instead of a target. An override you set yourself is still
      honoured, so the diary stays usable.`,
    meta: [
      ["File", "src/lib/calories.ts"],
      ["Cap", "MAX_AUTOMATIC_ADJUSTMENT = 500"],
      ["Floor", "MIN_AUTOMATIC_TARGET_KCAL = 1200"],
    ],
    figure: targetFigure,
  },
  {
    title: "AI that proposes, and never writes",
    lead: `Off by default. Switched on, it points at an Ollama instance on your own network &mdash; so a
      photo, a sentence or a recipe URL becomes a draft without a word of it reaching anyone else's
      servers. A background worker runs the job, resolves each named component against the food
      database, and files a proposal.`,
    body: `A proposal is not an entry. Nutrition is always read from a resolved food, never taken from
      the model, and a component nothing matched is shown as unresolved rather than quietly estimated.
      Fetches are checked against a private-address guard before a request is made, and page text
      reaches the model as untrusted data, never as instructions.`,
    meta: [
      ["Providers", "src/providers/ollama.ts &middot; src/providers/searxng.ts"],
      ["Queue", "AiJob &middot; AiJobAttempt &middot; AiProposal"],
      ["Default", "off &mdash; nothing is called until you configure it"],
    ],
    figure: `<div class="figure" data-reveal>${aiDiagram}<div class="figure-caption">Nothing crosses the last arrow unreviewed, and a component with no resolved food is never written at all. Nutrition always comes from the database, never from the model. src/server/ai-jobs.ts, ai-approval.ts, component-resolver.ts.</div></div>`,
    reverse: true,
  },
  {
    title: "Body scanning as geometry, not a model",
    lead: `Two silhouettes give a breadth and a depth at the same height. The circumference of that
      cross-section is the perimeter of an ellipse. There are no learned weights anywhere in it, so
      there is no training population to fall outside of &mdash; and the photographs never leave your
      instance.`,
    body: `Heights are the same <code>BODY_LANDMARKS</code> the drawn figure is built from, so a scan
      and the figure it feeds answer to one model of where a waist is. Nothing here has been validated
      against a tape measure &mdash; which is exactly why every result carries an interval and the
      interface never presents one as a measurement.`,
    meta: [
      ["File", "src/lib/body-scan.ts &middot; docs/BODY_SCAN.md"],
      ["Pure", "mask in, numbers out &mdash; swappable for segmentation later"],
      ["Honesty", "an interval on every estimate"],
    ],
    figure: `<div class="figure" data-reveal>${scanDiagram}<div class="figure-caption">The heights it measures at are the same BODY_LANDMARKS the drawn figure is built from, so a scan and the figure it feeds cannot drift apart. Images are discarded once a scan finishes; the estimate, and its interval, is what persists.</div></div>`,
  },
  {
    title: "One image, two processes, one command",
    lead: `A standalone Next.js build, an entrypoint that applies migrations before anything answers, a
      health check that knows whether it is inside the web process or the worker, and a published
      multi-architecture image. It runs on a NAS or a spare box; it does not need a cloud.`,
    body: `Continuous integration runs the full production build, the end-to-end suite against a real
      PostgreSQL, and a complete food-database import &mdash; then repeats the import to prove it is
      idempotent. That last step is the one thing a unit test with a temporary fixture directory cannot
      show.`,
    meta: [
      ["Image", facts.registry],
      ["Runtime", `Node ${facts.nodeVersion} on Alpine &middot; PostgreSQL ${facts.postgresVersion}`],
      ["Arch", "linux/amd64 &middot; linux/arm64 on release tags"],
    ],
    figure: opsFigure,
    reverse: true,
  },
];

const entryMarkup = entries
  .map(
    (entry, index) => `
      <article class="entry${entry.reverse ? " reverse" : ""}" data-reveal>
        <div class="entry-index">${String(index + 1).padStart(2, "0")}</div>
        <div class="entry-body">
          <h3 class="h3">${entry.title}</h3>
          <div class="prose">
            <p>${entry.lead}</p>
            <p>${entry.body}</p>
          </div>
          <ul class="meta-list">
            ${entry.meta.map(([key, value]) => `<li><span class="key">${key}</span><span>${value}</span></li>`).join("\n            ")}
          </ul>
        </div>
        <div class="entry-figure">${entry.figure}</div>
      </article>`,
  )
  .join("\n");

const body = `
<section class="hero">
  <div class="shell hero-inner grid">
    <div class="hero-copy">
      <p class="eyebrow">Self-hosted &middot; no account &middot; no subscription &middot; v${facts.version}</p>
      <h1 class="display">Yours to run.<br />Yours to <em>change</em>.<br />Yours to keep.</h1>
      <p class="lede">
        NutriCore is nutrition tracking you install on a machine you own. No account
        with anyone, nothing to subscribe to, no ads and no telemetry &mdash; and in
        its default configuration, not one request leaves the container. Every
        source, every target and every food in it is yours to switch off, override
        or replace.
      </p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="demo.html">
          Open the demo
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </a>
        <a class="btn btn-secondary" href="build.html">Build &amp; deploy</a>
      </div>
      <p class="hero-note">
        <span class="dot"></span>
        <span>No account</span>
        <span>No subscription</span>
        <span>No telemetry</span>
        <span>${facts.settings} settings in one .env</span>
      </p>
    </div>
    <div class="hero-panel">${heroPanel}</div>
  </div>
</section>

<section class="measures">
  <div class="shell">
    <div class="measures-inner">
      <div class="measure">
        <b>0</b>
        <span>requests that leave your machine in the default configuration</span>
      </div>
      <div class="measure">
        <b>&euro;0</b>
        <span>no subscription, no ads, nothing held back behind a plan</span>
      </div>
      <div class="measure">
        <b>${facts.settings}</b>
        <span>documented settings &mdash; every source and feature can be switched off</span>
      </div>
      <div class="measure">
        <b>${num(facts.foods.total)}</b>
        <span>reference foods, searched without a network call</span>
      </div>
    </div>
  </div>
</section>

<section class="band">
  <div class="shell grid">
    <div class="section-head" data-reveal>
      <p class="eyebrow">What it actually does</p>
      <h2 class="h2">Most trackers are a service you visit. This one is software you run.</h2>
      <p class="lede">
        Which changes what it can afford to do &mdash; and what it has to refuse.
        Ten decisions that follow from it, each one named next to the file in the
        source tree that makes it.
      </p>
    </div>
${entryMarkup}
  </div>
</section>

<section class="band band-line band-fill">
  <div class="shell grid">
    <div class="section-head" style="grid-column:span 5;margin-bottom:0" data-reveal>
      <p class="eyebrow">Getting it running</p>
      <h2 class="h2">A file, two commands, one import.</h2>
      <p class="lede" style="margin-top:1rem">
        Compose pulls the published image, applies migrations on start and comes
        up healthy once PostgreSQL answers. Importing the bundled databases is a
        single command you may safely run again.
      </p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="build.html">
          Read the deployment guide
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </a>
      </div>
    </div>
    <div style="grid-column:span 7" data-reveal>
      <div class="code">
        <div class="code-head"><span>bash</span><button class="copy" type="button" data-copy>Copy</button></div>
<pre><span class="c"># 1 - configuration</span>
cp .env.example .env
openssl rand -base64 48   <span class="c"># APP_SECRET</span>

<span class="c"># 2 - bring the stack up</span>
docker compose up -d

<span class="c"># 3 - import BLS 4.0 and USDA (idempotent)</span>
docker compose exec app npm run db:import:foods

<span class="c"># ${num(facts.foods.total)} foods, answered without a network call</span>
curl -s localhost:3000/api/health
<span class="s">{"status":"ok","service":"nutricore","database":"ok"}</span></pre>
      </div>
      <div class="callout" style="margin-top:1.2rem">
        <strong>The first account is the administrator.</strong> Registration is
        invitation-based after that, so an exposed instance does not quietly
        collect strangers.
      </div>
    </div>
  </div>
</section>

<section class="band band-line">
  <div class="shell grid">
    <div style="grid-column:span 12;text-align:center" data-reveal>
      <p class="eyebrow plain" style="justify-content:center">Have a look around</p>
      <h2 class="h2" style="max-width:20ch;margin:0 auto 1.4rem">The interface, with the data standing still.</h2>
      <p class="lede" style="margin:0 auto 2rem;text-align:center">
        A working reconstruction of the day view, the search, the micronutrient
        breakdown and the AI review queue &mdash; running on a static fixture, so
        it needs no server and stores nothing.
      </p>
      <a class="btn btn-primary" href="demo.html">
        Open the demo
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </a>
    </div>
  </div>
</section>
`;

export const home = page({
  id: "home",
  title: "NutriCore — nutrition tracking that runs on your own server",
  description: `Self-hosted nutrition tracking with no account, no subscription and no telemetry. ${facts.settings} settings in one .env, a personal goal for any of ${facts.nutrients} nutrients, and ${num(facts.foods.total)} reference foods searched without a network call.`,
  body,
});
