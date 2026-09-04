/**
 * The deep-dive page: how the thing is built, how it is configured, and how it
 * is deployed and kept running.
 *
 * Written against the repository rather than against the README, so the file
 * names, environment variables, workflow jobs and recovery paths named here are
 * the ones that exist. Where a number appears it comes from `data.mjs`.
 */
import { facts, num } from "../data.mjs";
import { page } from "../layout.mjs";

const SECTIONS = [
  { id: "stack", label: "The stack" },
  { id: "quickstart", label: "Quick start" },
  { id: "configuration", label: "Configuration" },
  { id: "databases", label: "Food databases" },
  { id: "ai", label: "Optional AI" },
  { id: "deploy", label: "Deployment" },
  { id: "operate", label: "Upgrade & backup" },
  { id: "code", label: "The codebase" },
  { id: "pipelines", label: "CI &amp; releases" },
];

const code = (language, source) => `
<div class="code">
  <div class="code-head"><span>${language}</span><button class="copy" type="button" data-copy>Copy</button></div>
<pre>${source.trim()}</pre>
</div>`;

const ENV_ROWS = [
  ["APP_SECRET", "required", "At least 32 characters. Signs sessions. <code>openssl rand -base64 48</code>."],
  ["APP_URL", "http://localhost:3000", "Public URL. Cookies are marked <code>Secure</code> when this is https."],
  ["POSTGRES_PASSWORD", "required", "Compose builds <code>DATABASE_URL</code> from it, so the two cannot drift apart."],
  ["APP_IMAGE", `${facts.registry}:latest`, "Pin a version tag for a reproducible deployment."],
  ["DEFAULT_LOCALE", "de", "Default for new accounts and signed-out visitors: <code>de</code> or <code>en</code>."],
  ["BLS_ENABLED", "true", `The bundled German database — ${num(facts.foods.bls.records)} foods, answered locally.`],
  ["USDA_ENABLED", "true", `The bundled USDA releases — ${num(facts.foods.usda.records)} foods, answered locally.`],
  ["OPENFOODFACTS_ENABLED", "true", "Branded products over the network. Set a real <code>OPENFOODFACTS_USER_AGENT</code>."],
  ["AI_ENABLED", "false", "Turns on the worker, the queue and the review screens. Nothing is called while it is off."],
  ["AI_BASE_URL", "—", "Your Ollama instance. It is never started by this stack."],
  ["RESEARCH_ENABLED", "false", "Web research through SearXNG, behind the same review step."],
  ["IMAGE_UPLOAD_MAX_MB", "5", "Whole MiB, 1–50. Enforced before anything is persisted."],
  ["INVITATION_EXPIRY_HOURS", "72", "How long an invitation link stays valid."],
  ["SMTP_ENABLED", "false", "Invitations are shown in the interface when mail is off."],
];

const body = `
<section class="band-tight" style="padding-top:clamp(2.5rem,5vw,4rem)">
  <div class="shell grid">
    <div class="section-head" style="grid-column:span 7;margin-bottom:0">
      <p class="eyebrow">Setup &middot; code &middot; deployment</p>
      <h1 class="h2">From an empty machine to a running instance.</h1>
      <p class="lede" style="margin-top:1rem">
        NutriCore is one container image, one PostgreSQL database and a
        <code>.env</code> file. This page covers what that image contains, what
        each variable does, where the food data comes from, how upgrades and
        backups work, and which workflow builds what.
      </p>
    </div>
    <div style="grid-column:span 5;align-self:end">
      <div class="figure">
      <p class="eyebrow plain" style="margin-bottom:0.9rem">Specification</p>
      <ul class="meta-list" style="border-top:0;padding-top:0;margin-top:0">
        <li><span class="key">Runtime</span><span>Node ${facts.nodeVersion} on Alpine &middot; PostgreSQL ${facts.postgresVersion}</span></li>
        <li><span class="key">Image</span><span>${facts.registry}</span></li>
        <li><span class="key">Arch</span><span>linux/amd64, plus linux/arm64 on release tags</span></li>
        <li><span class="key">Licence</span><span>${facts.license}</span></li>
      </ul>
      </div>
    </div>
  </div>
</section>

<section class="band-tight" style="padding-top:0">
  <div class="shell docs-layout">
    <nav class="toc" aria-label="On this page">
      <h2>On this page</h2>
      <div class="toc-links">
        ${SECTIONS.map((section) => `<a href="#${section.id}">${section.label}</a>`).join("\n        ")}
      </div>
    </nav>

    <div>
      <!-- ------------------------------------------------------------- -->
      <section class="doc-section" id="stack">
        <p class="eyebrow">01</p>
        <h2 class="h2">One image, two processes</h2>
        <div class="prose">
          <p>
            The build produces a Next.js standalone server: the application
            bundle plus its own <code>server.js</code>, without the toolchain
            that produced it. The same image runs both the web process and the
            AI worker &mdash; a single environment variable,
            <code>NUTRICORE_PROCESS</code>, decides which.
          </p>
          <p>
            The entrypoint applies pending migrations before either process
            answers, using <code>prisma migrate deploy</code> and never
            <code>db push</code>: a schema comparison can drop columns to make a
            live database match, which on an upgrade means losing data.
          </p>
        </div>
        ${code(
          "container",
          `<span class="c"># The two processes, from one image</span>
app     &rarr; node server.js                 <span class="c"># Next.js standalone</span>
worker  &rarr; node --import tsx src/worker.ts <span class="c"># AI queue, dataset import</span>

<span class="c"># The health check knows which one it is inside</span>
app     &rarr; wget http://127.0.0.1:3000/api/health
worker  &rarr; heartbeat file, written on every queue poll`,
        )}
        <div class="callout" style="margin-top:1.4rem">
          <strong>Why the worker has its own check.</strong> The worker serves
          no HTTP, so an HTTP probe reported it unhealthy for ever &mdash; and an
          orchestrator that waits for every service, TrueNAS among them, then
          showed the whole stack as deploying while the worker was doing its
          job.
        </div>
        <div class="split">
          <div class="figure">
            <h3 class="h4" style="margin-bottom:0.8rem">Request path</h3>
            <p class="tree"><b>Browser</b>
  &darr; server component
<b>Next.js 15</b> &middot; App Router
  &darr; server action / route handler
<b>src/server/*</b> &middot; business rules
  &darr; Prisma
<b>PostgreSQL ${facts.postgresVersion}</b>
  &darr; only if a tier misses
<b>Open Food Facts</b> &middot; FatSecret</p>
          </div>
          <div class="figure">
            <h3 class="h4" style="margin-bottom:0.8rem">Requirements</h3>
            <ul class="meta-list" style="border-top:0;padding-top:0;margin-top:0">
              <li><span class="key">Host</span><span>Anything running Docker; 2 GB RAM is comfortable</span></li>
              <li><span class="key">Database</span><span>PostgreSQL ${facts.postgresVersion} (the compose file brings one)</span></li>
              <li><span class="key">Disk</span><span>Roughly 1 GB once the food databases are imported</span></li>
              <li><span class="key">Network</span><span>None required after the image is pulled</span></li>
              <li><span class="key">Optional</span><span>An Ollama host for AI; a SearXNG instance for research</span></li>
            </ul>
          </div>
        </div>
      </section>

      <!-- ------------------------------------------------------------- -->
      <section class="doc-section" id="quickstart">
        <p class="eyebrow">02</p>
        <h2 class="h2">Quick start</h2>
        <div class="prose">
          <p>
            Four steps from a clone to an instance holding
            ${num(facts.foods.total)} foods. Nothing is downloaded at runtime:
            the databases are already inside the image.
          </p>
        </div>

        <ol class="steps">
          <li class="step">
            <h3>Write a configuration</h3>
            <div class="prose">
              <p>
                Copy the example and set the two values that have no safe
                default: the application secret and the database password.
              </p>
            </div>
            ${code(
              "bash",
              `git clone ${facts.repo}.git
cd NutriCore
cp .env.example .env

<span class="c"># APP_SECRET — at least 32 characters</span>
openssl rand -base64 48`,
            )}
          </li>

          <li class="step">
            <h3>Bring the stack up</h3>
            <div class="prose">
              <p>
                Compose starts PostgreSQL, waits for it to report healthy, then
                starts the application and the worker. Both apply migrations on
                the way up.
              </p>
            </div>
            ${code(
              "bash",
              `<span class="c"># Prebuilt image from the registry</span>
docker compose up -d

<span class="c"># …or build the image from this checkout</span>
docker compose up -d --build

docker compose ps
curl -s localhost:3000/api/health`,
            )}
          </li>

          <li class="step">
            <h3>Import the bundled food databases</h3>
            <div class="prose">
              <p>
                One command, safe to repeat: the manifest records a checksum per
                artifact, so a second run costs one query per dataset and
                changes nothing. The worker also runs this in the background on
                startup, and <em>Admin &rarr; Food databases</em> has a button.
              </p>
            </div>
            ${code("bash", `docker compose exec app npm run db:import:foods`)}
          </li>

          <li class="step">
            <h3>Create the first account</h3>
            <div class="prose">
              <p>
                Open the instance and register. The first account becomes the
                administrator; every account after it needs an invitation, so an
                exposed instance does not quietly collect strangers.
              </p>
            </div>
            ${code("text", `http://localhost:3000  &rarr;  Register  &rarr;  Onboarding  &rarr;  Diary`)}
          </li>
        </ol>
      </section>

      <!-- ------------------------------------------------------------- -->
      <section class="doc-section" id="configuration">
        <p class="eyebrow">03</p>
        <h2 class="h2">Configuration</h2>
        <div class="prose">
          <p>
            Every setting lives in <code>.env</code> and is documented in
            <code>.env.example</code>, which is the authoritative list. These are
            the ones worth knowing before the first start.
          </p>
        </div>
        <div class="table-wrap" style="margin-top:1.4rem">
          <table>
            <thead>
              <tr><th>Variable</th><th>Default</th><th>What it decides</th></tr>
            </thead>
            <tbody>
              ${ENV_ROWS.map(
                ([name, value, description]) =>
                  `<tr><td><code>${name}</code></td><td class="num">${value}</td><td>${description}</td></tr>`,
              ).join("\n              ")}
            </tbody>
          </table>
        </div>
        <div class="callout" style="margin-top:1.4rem">
          <strong>The compose file deliberately omits most of them.</strong>
          A key under <code>environment:</code> overrides <code>env_file:</code>,
          so a default written there would silently beat the value you set in
          <code>.env</code>. Only <code>DATABASE_URL</code> and
          <code>NUTRICORE_PROCESS</code> are set that way, because they are
          derived rather than chosen.
        </div>
      </section>

      <!-- ------------------------------------------------------------- -->
      <section class="doc-section" id="databases">
        <p class="eyebrow">04</p>
        <h2 class="h2">Where the food data comes from</h2>
        <div class="prose">
          <p>
            Two upstream sources are converted into committed artifacts and
            imported into PostgreSQL:
            <strong>BLS ${facts.foods.bls.version}</strong> with
            ${num(facts.foods.bls.records)} generic foods across
            ${facts.foods.bls.components} components, and
            <strong>USDA FoodData Central</strong> &mdash;
            ${num(facts.foods.usda.foundation)} Foundation Foods plus
            ${num(facts.foods.usda.legacy)} SR Legacy entries.
          </p>
          <p>
            The conversion is a build step, not a deployment step. It exists
            because the originals are a 14 MB spreadsheet that inflates to 99 MB
            of XML and 208 MB of JSON carrying footnotes nothing reads; because
            an artifact under version control is diffable and identical on every
            machine; and because the converter can then be held to transcribing
            the source faithfully while every semantic decision stays in the
            importer, where it is unit tested against those same files.
          </p>
        </div>
        ${code(
          "bash",
          `<span class="c"># Only needed when refreshing a dataset release</span>
npm run datasets:convert

<span class="c"># Idempotent — run it on every deployment if you like</span>
npm run db:import:foods

<span class="c"># datasets/bundled/manifest.json records what was produced</span>
{
  <span class="k">"bls"</span>: {
    <span class="k">"version"</span>: <span class="s">"${facts.foods.bls.version}"</span>,
    <span class="k">"records"</span>: <span class="p">${facts.foods.bls.records}</span>,
    <span class="k">"artifactSha256"</span>: <span class="s">"5a864271f8…"</span>
  }
}`,
        )}
        <div class="prose" style="margin-top:1.4rem">
          <p>
            Anything the source did not state stays unstated. A record that
            writes <code>-</code>, <code>TR</code> or <code>&lt;LOD</code> is
            carried through as written and shown as absent rather than as zero,
            because a nutrient nobody measured and a nutrient measured at zero
            are not the same claim.
          </p>
        </div>
      </section>

      <!-- ------------------------------------------------------------- -->
      <section class="doc-section" id="ai">
        <p class="eyebrow">05</p>
        <h2 class="h2">Optional AI, on your own hardware</h2>
        <div class="prose">
          <p>
            Off by default. Switched on, it points at an Ollama instance you
            already run &mdash; the compose stack never starts one, and models
            are pulled on the Ollama host. A photo, a sentence or a recipe URL
            becomes a job; the worker resolves each named component against the
            food database and files a proposal for review.
          </p>
        </div>
        ${code(
          "env",
          `AI_ENABLED=true
AI_PROVIDER=ollama
AI_BASE_URL=http://ollama.lan:11434
AI_MODEL=qwen3.5:4b
OLLAMA_TIMEOUT_SECONDS=600

<span class="c"># Web research, behind the same review step</span>
RESEARCH_ENABLED=true
SEARXNG_URL=http://searxng.lan:8080`,
        )}
        <div class="split">
          <div class="figure">
            <h3 class="h4" style="margin-bottom:0.8rem">What the model may do</h3>
            <div class="prose" style="font-size:0.92rem">
              <p>
                Name a dish, list its components, state a quantity the source
                gave, and convert a household measure into grams. Its output is
                validated against a Zod schema before anything downstream reads
                it.
              </p>
            </div>
          </div>
          <div class="figure">
            <h3 class="h4" style="margin-bottom:0.8rem">What it may not</h3>
            <div class="prose" style="font-size:0.92rem">
              <p>
                Supply nutrition values, write a diary entry, or have its
                unresolved components approved. Page text reaches it as untrusted
                data, and every fetch is checked against a private-address guard
                first, so a research job cannot be steered at your LAN.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- ------------------------------------------------------------- -->
      <section class="doc-section" id="deploy">
        <p class="eyebrow">06</p>
        <h2 class="h2">Deployment</h2>
        <div class="prose">
          <p>
            Three paths, same image. Pick by how much you want to build
            yourself.
          </p>
        </div>

        <div class="tabset" data-tabset style="margin-top:1.4rem">
          <div class="tabset-bar" role="tablist" aria-label="Deployment target">
            <button role="tab" type="button" aria-selected="true" tabindex="0">Compose</button>
            <button role="tab" type="button" aria-selected="false" tabindex="-1">TrueNAS SCALE</button>
            <button role="tab" type="button" aria-selected="false" tabindex="-1">From source</button>
          </div>
          <div class="tabset-body">
            <div role="tabpanel">
              ${code(
                "bash",
                `<span class="c"># Pin a tag rather than tracking latest</span>
echo 'APP_IMAGE=${facts.registry}:v${facts.version}' &gt;&gt; .env

docker compose pull
docker compose up -d
docker compose exec app npm run db:import:foods`,
              )}
            </div>
            <div role="tabpanel" hidden>
              <div class="prose" style="font-size:0.93rem;margin-bottom:1rem">
                <p>
                  Point the two path variables at datasets rather than at
                  directories inside the app, so an application update never
                  touches the data.
                </p>
              </div>
              ${code(
                "env",
                `POSTGRES_DATA_PATH=/mnt/tank/apps/nutricore/postgres
BACKUP_PATH=/mnt/tank/apps/nutricore/backups
APP_PORT=3000
APP_URL=https://nutricore.your.lan`,
              )}
            </div>
            <div role="tabpanel" hidden>
              ${code(
                "bash",
                `npm ci
npx prisma generate
npx prisma migrate deploy
npm run db:seed          <span class="c"># nutrient catalogue</span>
npm run db:import:foods  <span class="c"># ${num(facts.foods.total)} foods</span>
npm run dev              <span class="c"># or: npm run build &amp;&amp; npm start</span>
npm run worker           <span class="c"># second terminal, only with AI on</span>`,
              )}
            </div>
          </div>
        </div>
      </section>

      <!-- ------------------------------------------------------------- -->
      <section class="doc-section" id="operate">
        <p class="eyebrow">07</p>
        <h2 class="h2">Upgrade, backup, restore</h2>
        <div class="prose">
          <p>
            An upgrade is a pull and a recreate; migrations run on the way up.
            A backup is a <code>pg_dump</code> into the mounted backup path, and
            a restore goes into an <em>empty</em> database, because a dump
            restored over live tables leaves rows that belong to neither.
          </p>
        </div>
        ${code(
          "bash",
          `<span class="c"># Upgrade</span>
docker compose pull
docker compose up -d

<span class="c"># Backup</span>
docker compose exec db pg_dump -U nutricore -Fc nutricore \\
  &gt; backups/nutricore-$(date +%F).dump

<span class="c"># Restore into an empty database</span>
docker compose stop app worker
docker compose exec db dropdb -U nutricore nutricore
docker compose exec db createdb -U nutricore nutricore
docker compose exec -T db pg_restore -U nutricore -d nutricore &lt; backups/&lt;file&gt;.dump
docker compose start app worker`,
        )}
        <div class="callout warn" style="margin-top:1.4rem">
          <strong>If a migration is recorded as failed</strong> (Prisma
          <code>P3009</code>), every later deploy is blocked and both containers
          restart for ever. The entrypoint recognises this, marks the failed
          migration rolled back and applies it again &mdash; once per start, and
          loudly. Prisma runs each migration inside a transaction, so the failed
          one left nothing of itself behind.
        </div>
      </section>

      <!-- ------------------------------------------------------------- -->
      <section class="doc-section" id="code">
        <p class="eyebrow">08</p>
        <h2 class="h2">Reading the codebase</h2>
        <div class="prose">
          <p>
            The split that matters is between <code>src/lib</code> and
            <code>src/server</code>: pure rules that can be tested without a
            database, and everything that touches one. Nutrition arithmetic,
            unit conversion, ranking, the body-scan geometry and the target
            calculation all live on the pure side, which is why
            ${facts.tests} test files can cover them without fixtures.
          </p>
        </div>
        <div class="figure" style="margin-top:1.4rem">
          <p class="tree"><b>src/</b>
├── <b>app/</b>            <i>App Router pages, server actions, API routes</i>
│   ├── diary/       <i>the day view</i>
│   ├── ai-review/   <i>proposals waiting for a person</i>
│   └── api/         <i>health, food search, exports</i>
├── <b>lib/</b>            <i>pure rules — no database, no network</i>
│   ├── calories.ts  <i>Mifflin–St Jeor, multipliers, guardrails</i>
│   ├── nutrients.ts <i>the ${facts.nutrients}-row catalogue</i>
│   ├── body-scan.ts <i>ellipse geometry, no learned weights</i>
│   └── url-guard.ts <i>private-address rejection</i>
├── <b>server/</b>         <i>persistence, providers, orchestration</i>
│   ├── foods.ts     <i>search across tiers</i>
│   ├── ai-jobs.ts   <i>the queue the worker drains</i>
│   └── food-datasets/ <i>BLS and USDA importers</i>
├── <b>providers/</b>      <i>one file per external source</i>
└── <b>worker.ts</b>       <i>the second process</i>

<b>prisma/</b>           <i>${facts.models} models, migrations, seed</i>
<b>datasets/bundled/</b>  <i>checksummed artifacts, ~5 MB</i>
<b>e2e/</b>              <i>${facts.e2eSuites} Playwright suites</i>
<b>website/</b>          <i>this site — a zero-dependency generator</i></p>
        </div>
        ${code(
          "bash",
          `npm run check      <span class="c"># lint + typecheck + unit tests</span>
npm test           <span class="c"># vitest</span>
npm run test:e2e   <span class="c"># playwright, against a production build</span>
npm run db:studio  <span class="c"># prisma studio</span>`,
        )}
      </section>

      <!-- ------------------------------------------------------------- -->
      <section class="doc-section" id="pipelines">
        <p class="eyebrow">09</p>
        <h2 class="h2">Continuous integration and releases</h2>
        <div class="prose">
          <p>
            Three workflows. <code>ci.yml</code> proves the application works,
            <code>publish.yml</code> puts an image in the registry, and
            <code>website.yml</code> builds and deploys this site.
          </p>
        </div>
        <div class="table-wrap" style="margin-top:1.4rem">
          <table>
            <thead><tr><th>Workflow</th><th>Job</th><th>What it proves</th></tr></thead>
            <tbody>
              <tr><td><code>ci.yml</code></td><td>test</td><td>Lint, typecheck, ${facts.tests} unit and integration test files, a production build, then ${facts.e2eSuites} Playwright suites against a real PostgreSQL ${facts.postgresVersion}.</td></tr>
              <tr><td><code>ci.yml</code></td><td>datasets</td><td>The committed artifacts still import into a database that has only seen migrations &mdash; then the import is repeated to prove it changed nothing.</td></tr>
              <tr><td><code>ci.yml</code></td><td>docker</td><td>The production image builds, and its runtime Prisma CLI loads &mdash; the failure that once put the container in a restart loop.</td></tr>
              <tr><td><code>publish.yml</code></td><td>verify &rarr; publish</td><td>Fast checks first, then a multi-architecture image with provenance and an SBOM, tagged by semver on a release.</td></tr>
              <tr><td><code>website.yml</code></td><td>build &rarr; deploy</td><td>This site is generated, checked for dead internal links and missing assets, and published to GitHub Pages from <code>main</code>.</td></tr>
            </tbody>
          </table>
        </div>
        ${code(
          "bash",
          `<span class="c"># The website, built the same way CI builds it</span>
node website/build.mjs
python3 -m http.server -d website/dist 4000`,
        )}
        <div class="callout" style="margin-top:1.4rem">
          <strong>The dataset job is separate on purpose.</strong> Importing
          ${num(facts.foods.total)} foods into the test job's database would also
          put them in front of the end-to-end suite, which searches for foods it
          creates itself. Isolating it keeps both honest.
        </div>
      </section>
    </div>
  </div>
</section>

<section class="band band-line band-fill">
  <div class="shell grid">
    <div style="grid-column:span 12;text-align:center">
      <p class="eyebrow plain" style="justify-content:center">Next</p>
      <h2 class="h2" style="max-width:22ch;margin:0 auto 1.4rem">Read the source, or look at the screens first.</h2>
      <div class="hero-actions" style="justify-content:center">
        <a class="btn btn-primary" href="${facts.repo}" rel="noreferrer noopener">Open the repository</a>
        <a class="btn btn-secondary" href="demo.html">Open the demo</a>
      </div>
    </div>
  </div>
</section>
`;

export const build = page({
  id: "build",
  title: "Build & deploy NutriCore — setup, configuration and operations",
  description:
    "How NutriCore is built, configured, deployed and upgraded: one container image, PostgreSQL, the bundled food databases, optional local AI, and the workflows that publish it all.",
  body,
});
