# NutriCore

Privacy-first, self-hosted food, calorie and nutrition tracking for a private
server. No ads, no analytics, no subscription. Nutrition data carries explicit
provenance, and a value that is unknown stays unknown rather than becoming zero.

NutriCore is a TypeScript modular monolith: Next.js serves the responsive PWA
and the API, Prisma owns the PostgreSQL schema, and provider modules isolate
external data and AI behind adapters.

**Website:** [macnite.github.io/NutriCore](https://macnite.github.io/NutriCore/)
— feature overview, an interactive demo running on static data, and a deep dive
on setup, the codebase and deployment. Its source is in [`website/`](website/),
and it is published by
[`.github/workflows/website.yml`](.github/workflows/website.yml).

## Screens and features

Implemented and covered by tests:

- **Accounts** — local email + password, Argon2id hashing, opaque session
  tokens stored only as SHA-256 hashes, HTTP-only cookies, logout, account
  deletion. No external identity provider.
- **Onboarding and profile** — display name, language, date of birth, height,
  weight, biological sex, activity level and goal.
- **Calorie target** — Mifflin-St Jeor. Every component (BMR, activity
  multiplier, TDEE, goal adjustment, calculated target, manual override) is
  stored and displayed, never just the final number.
- **Daily diary** — breakfast/lunch/dinner/snacks, add, edit, remove, copy the
  previous day, day navigation, per-meal and per-day totals.
- **Nutrition snapshots** — every entry freezes its nutrition at logging time,
  so a later provider update cannot rewrite history.
- **Food search** — local-first pipeline (barcode → exact → favourites →
  recent/frequent → custom foods → cached external → fuzzy → remote), debounced,
  with deterministic ranking and visible source badges.
- **Open Food Facts** — barcode lookup and free-text search, local caching,
  full provenance, graceful degradation when unreachable.
- **Custom foods** — user-created foods with an explicit basis, servings and
  optional density. Empty fields stay unknown.
- **Recipes** — create and edit recipes from existing foods, inspect nutrition
  per serving and per 100 g with coverage, and log immutable recipe snapshots.
- **Sharing recipes with the instance** — opt-in: publish one of your recipes
  for the other members of this installation, browse what they have shared, and
  save a shared recipe as your own independent copy. See
  [Sharing recipes](#sharing-recipes).
- **Weight tracking** — entries, chart with a 7-day moving average and goal
  line, plus an accessible text summary and table.
- **Settings** — profile, target override, language, AI and research toggles.
  Secrets are never displayed.
- **Administration** — for the `ADMIN` role only: invite or batch-invite users with single-use
  links, activate and deactivate accounts, watch the AI job queue with its
  retries and errors, and check service reachability (diagnostics). Reachable
  from Settings → Administration.
- **Export** — versioned JSON of all personal records, including what you have
  published, plus diary and weight CSV. Credentials are excluded.
- **German and English** throughout, with locale-correct number formatting
  (`1.234,5 kcal` / `1,234.5 kcal`).
- **Light / dark / system themes**, responsive layout with bottom navigation on
  mobile, PWA manifest.

- **AI food search** — when a search finds nothing, a local Ollama model
  reconstructs the dish, ingredients are matched against the database, and the
  result is reviewed and confirmed before anything is stored. See
  [AI food search](#ai-food-search).
- **Web research** — optional, off by default: an AI run may be given source
  URLs, fetched through an SSRF guard and sanitised before the model sees them.

Designed and unit-tested, but not yet wired into the UI — see
[Deferred to Phase 2](#deferred-to-phase-2):

- USDA FoodData Central adapter

## Architecture

```
src/app/        App Router pages and route handlers
src/components/ Shared UI
src/server/     Session, authorisation and domain services
src/lib/        Pure domain logic (nutrition, calories, units, ranking, …)
src/providers/  External adapters and the food source registry
                (Open Food Facts, USDA FoodData Central, FatSecret, Ollama)
src/i18n/       Locale resolution
messages/       de.json / en.json translation catalogues
prisma/         Schema, migrations and the optional development seed
datasets/raw/     Upstream food-database downloads (a build input, not shipped)
datasets/bundled/ The converted, versioned artifacts that do ship
e2e/            Playwright end-to-end specs
tests/          Authorisation and i18n integration tests
```

Route handlers and server actions resolve the session and authorise the tenant
before calling a service. Provider responses and AI output are validated with
Zod at the boundary. Public provider foods have no owner; every personal record
has a user relation. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Docker 25+ with Compose v2 (production), or
- Node.js 22+ and PostgreSQL 16+ (development)

## Quick start

```sh
cp .env.example .env
# Set APP_SECRET (openssl rand -base64 48) and POSTGRES_PASSWORD
docker compose up -d
```

Open <http://localhost:3000> and create the first account. Health is at
`/api/health`. The first registered account becomes the administrator; later
accounts should normally be invited. Invitations can be delivered through the
configurable SMTP mailer. No demo account is ever created
automatically.

**Administration** lives at `/admin`, reachable from Settings → Administration
for accounts with the `ADMIN` role. It invites users, activates and deactivates
accounts, and shows the AI job queue. NutriCore sends no email: creating an
invitation shows the single-use link once, on that page, for the administrator
as a fallback. With SMTP enabled, administrators can send individual or batch
invitations, and every signed-in user can invite another user from Settings.
to pass on themselves. If the link is lost, "Resend" issues a new one and
revokes the old.

When upgrading an installation that already had exactly one account before
roles were introduced, the database migration automatically promotes that
account to `ADMIN`. Sign out and back in after upgrading, then open Settings →
Administration. Installations with multiple legacy accounts are deliberately
not changed automatically; an operator can promote a specific account with:

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
UPDATE "User" SET "role" = 'ADMIN' WHERE "email" = 'you@example.com';
SQL
```

Replace `you@example.com` with the account email. The Administration link is
only rendered for administrators.

### Prebuilt image or local build

`docker compose up -d` pulls the prebuilt image named by `APP_IMAGE`
(`ghcr.io/macnite/nutricore:latest` by default). To build from source instead:

```sh
docker compose up -d --build
```

Images are published to the GitHub Container Registry by the
[Publish image](.github/workflows/publish.yml) workflow:

| Tag | Points at |
| --- | --- |
| `latest` | the most recent `v*.*.*` release |
| `v1.2.3`, `1.2`, `1` | a specific release |
| `main` | the tip of `main` — development, may be unstable |
| `sha-abc1234` | one exact commit |

Pin a version tag in `.env` for a reproducible deployment:

```env
APP_IMAGE=ghcr.io/macnite/nutricore:v0.1.0
```

Releases build for `linux/amd64` and `linux/arm64`; pushes to `main` build
`amd64` only. If the package is private, authenticate first with a personal
access token that has `read:packages`:

```sh
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <username> --password-stdin
```

## TrueNAS SCALE

1. Create two datasets, for example
   `/mnt/tank/apps/nutricore/postgres` and `/mnt/tank/apps/nutricore/backups`.
2. Put their absolute paths in `.env` as `POSTGRES_DATA_PATH` and `BACKUP_PATH`.
3. Deploy `docker-compose.yml` as a custom app.

The app container runs as an unprivileged user (uid 1001) with
`no-new-privileges`. PostgreSQL is only reachable on the compose network and is
never published to the host. Terminate TLS at your reverse proxy and set
`APP_URL` to the `https://` URL so session cookies are marked `Secure`.

## Environment variables

All variables are documented inline in [`.env.example`](.env.example).

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_IMAGE` | no | Prebuilt image to run; ignored when building locally |
| `APP_URL` | yes | Drives the `Secure` cookie flag and origin checks |
| `APP_SECRET` | yes | Minimum 32 characters; validated at start-up |
| `POSTGRES_PASSWORD` | yes | Compose builds `DATABASE_URL` from it |
| `DATABASE_URL` | outside compose | Standard PostgreSQL URL |
| `DEFAULT_LOCALE` | no | `de` (default) or `en` |
| `OPENFOODFACTS_ENABLED` | no | Default `true` |
| `OPENFOODFACTS_USER_AGENT` | recommended | App name plus a real contact address, e.g. `NutriCore/0.1 (you@example.com)`. OFF answers 403 to callers it cannot identify; `/admin` flags a placeholder value |
| `OPENFOODFACTS_SEARCH_URL` | no | Search-a-licious service; default `https://search.openfoodfacts.org` |
| `OPENFOODFACTS_SEARCH_BACKEND` | no | `search-a-licious` (default) or `legacy` to pin `/cgi/search.pl` |
| `AI_ENABLED` / `AI_BASE_URL` / `AI_MODEL` | no | Where the model lives and which one to use; defaults to `http://ollama:11434` and `qwen3.5:4b`. The superseded `OLLAMA_BASE_URL` / `OLLAMA_MODEL` are still read as a fallback |
| `AI_FALLBACK_MODEL` / `AI_CONFIDENCE_THRESHOLD` | no | Future low-confidence fallback policy; fallback is not called for every job |
| `SEARXNG_URL` / `SEARXNG_TIMEOUT_MS` | no | JSON source discovery used only after local foods miss |
| `INVITATION_EXPIRY_HOURS` | no | Single-use invitation lifetime; default 48 hours |
| `SMTP_ENABLED` / `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | no | SMTP delivery; setting `SMTP_HOST` makes environment configuration take precedence over the Administrator Panel |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | no | Optional SMTP authentication credentials |
| `SMTP_FROM_EMAIL` / `SMTP_FROM_NAME` | with environment SMTP | Sender address and display name for invitation email |
| `OLLAMA_TIMEOUT_SECONDS` | no | Model generation timeout; default `600` seconds |
| `BLS_ENABLED` | no | Default `true`. The bundled Bundeslebensmittelschlüssel 4.0; needs no credentials and makes no network request |
| `USDA_ENABLED` | no | Default `true` (**changed**: it defaulted to `false` while USDA was API-only). Enables the bundled Foundation and SR Legacy releases |
| `USDA_API_KEY` | no | Optional. Extends USDA search beyond the bundled releases to newer, Survey (FNDDS) and Branded records. Server-side only |
| `FATSECRET_ENABLED` | no | Default `false`. Optional external fallback; nothing changes for an installation that leaves it off |
| `FATSECRET_CLIENT_ID` / `FATSECRET_CLIENT_SECRET` | with FatSecret | OAuth 2.0 client credentials, exchanged server-side only. The Platform API also requires this deployment's outbound IP address to be registered with your FatSecret account |
| `FATSECRET_REGION` / `FATSECRET_LANGUAGE` | no | Premier-plan localisation. Left empty on a basic plan, where the capability is skipped rather than substituted |
| `RESEARCH_ENABLED` | no | Default `false`; only enables web sources for AI research |
| `RESEARCH_PROVIDER` / `SEARCH_API_*` | no | Reserved for Phase 2; leave unset when using SearXNG |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn`, `error` |

Start-up fails fast with a clear message if a required variable is missing or
invalid. Secrets are read from the environment only and are redacted from logs.

### Asynchronous AI worker, Ollama, and SearXNG

Ollama is **not** started by this compose stack — it already runs elsewhere on
your network. NutriCore only stores the connection details:

```env
AI_ENABLED=true
AI_BASE_URL=http://ollama:11434
AI_MODEL=qwen3.5:4b
SEARXNG_URL=http://searxng:8080
OLLAMA_TIMEOUT_SECONDS=600
```

**Models are pulled on the Ollama host, never by NutriCore:**

```sh
ollama pull qwen3.5:4b
```

Run the application and worker separately in development:

```sh
npm run dev
npm run worker
```

Compose starts both `app` and `worker`; the worker is the same image started
with `NUTRICORE_PROCESS=worker`, and without it queued meals stay queued.
The admin panel's diagnostics reports an old queued job as a worker error. A deployment
that does not use this Compose file must therefore create a second container
from the same image, with the same environment and `NUTRICORE_PROCESS=worker`.

Quick-meal images are transient queue payloads in PostgreSQL so a separate
worker container can read them. They are removed as soon as structured meal
extraction succeeds, on terminal failure or administrative cancellation/deletion,
and by the worker's TTL cleanup after at most 24 hours. Only normalized
components and non-sensitive input provenance remain in proposals/jobs.
The maximum meal and recipe image size defaults to 5 MiB and can be changed at
runtime with `IMAGE_UPLOAD_MAX_MB` (a whole number from 1 through 50). Next.js's
otherwise-1-MiB Server Action request ceiling is bounded separately at 51 MiB;
application validation still rejects anything above the configured file limit.

The two containers have separate environments and nothing makes them agree, so
the worker logs the settings it resolved on startup - AI host, model, timeout,
token cap, whether web research and SearXNG are configured. Compare that line
against the app's `.env` when a job fails for a reason the app would not have.
The worker deliberately needs no `APP_SECRET`: it signs no sessions, and reading
a single switch never parses the whole configuration.
SearXNG is intentionally not bundled:
point `SEARXNG_URL` at the operator's existing instance with JSON output enabled.
`SEARXNG_URL` itself selects SearXNG; do not set `RESEARCH_PROVIDER` for it.

**Every AI feature is asynchronous.** Submitting one inserts a record and an
`AiJob` and returns immediately; nothing waits for Ollama. That covers all four:
a free-text meal (`MEAL_INPUT`), logging a recipe to the diary (`RECIPE_LOG`),
AI food research (`RESEARCH`), and creating a recipe from a link, an image or
free text (`RECIPE_IMPORT`). Backfilling missing nutrition (`FOOD_ENRICHMENT`)
is background work and runs behind all of them, and recipe creation runs ahead
of all of them - see the priority note below.
The review pages refresh themselves while the worker is busy, so a queued job
does not look like a broken one.

**Backfilling missing nutrition needs the same permission as any other web
research.** `FOOD_ENRICHMENT` reaches the open web exactly as the component
resolver does, so it is refused unless `RESEARCH_ENABLED` is on, `SEARXNG_URL`
is configured, and the "Allow web research" switch is on for *both* the person
who caused the job - the administrator running the catalogue sweep, or the user
whose quick meal queued the follow-up - and, when the food belongs to somebody,
its owner. A shared catalogue food has no owner, so there the deployment switch
and the requester decide. A job that is not permitted fails as
`RESEARCH_NOT_PERMITTED` and does not retry; the sweep says so before queuing
anything rather than leaving 25 jobs to fail one by one.

Values it writes are marked `AI_ENRICHMENT` in `FoodNutrient.origin`, per
nutrient. A later dataset import therefore reclaims only the nutrients the new
release actually publishes and leaves the backfilled ones in the gaps it still
does not fill - a measured number always wins, and enrichment is no longer lost
on every dataset upgrade.

**A run reads the food's own pages before it searches for its name.** A
reference URL stored on the food - the label a user typed when creating it, or a
provider's product page - is about that food by construction, where a search for
a generic name can return a different product that happens to share it. It is
also the cheaper and more private path: one fetch of an address already on
record instead of naming the food to a search engine. The search still runs when
those pages cannot be read or carry no nutrition table, so a product page
without one does not leave the food permanently unenrichable. The backfill's own
past pages are never re-read - that would make a wrong extraction confirm itself.

**Each run asks about gaps no earlier run has tried.** One page is only ever
asked for twelve nutrient keys, but taking the first twelve every time made
three quarters of the catalogue unreachable: search already refuses a food with
no energy value, so most foods arrive with the macros present and their first
twelve gaps are exactly what no label publishes - trans fats, omega-3, chloride,
molybdenum. The window now moves through the catalogue in `sortOrder` and starts
round again only once every gap has been put to a source at least once.

**And nothing it finds reaches a food unreviewed.** A run records what it read
as a proposal and waits, which is the "human approves" clause the rest of the
app already honours. Who approves follows who owns the food, exactly as reading
it does: a food you created is reviewed by you, on its own page; the shared
catalogue is reviewed by an administrator, on /admin. An administrator never
sees a proposal for a food somebody owns - they cannot open that food anywhere
else either. Approving writes the value only into a gap, so it can never
overwrite a measured number; refusing one that is already in use takes it back
off the food. Turn on "Apply backfilled nutrition without review" in the privacy
settings to skip the queue and write straight through, as it worked before.

#### How a quick meal becomes diary entries

A quick meal accepts text, an image, a public recipe URL, or any combination.
For a URL, the worker opens the exact submitted address directly (SearXNG is
never a proxy). It validates DNS and every redirect against private, loopback,
link-local and reserved networks, permits only standard web ports, follows at
most three redirects, times out after 10 seconds and accepts HTML/plain text
only. A page is read up to 512 KB and the rest is abandoned mid-transfer, with
one exception: the read continues, within a 4 MB budget, to pick up complete
Recipe JSON-LD blocks that sit past the cap, since publishers routinely put
them after half a megabyte of markup and inline script. Nothing else from
beyond the cap is kept. No cookies, authorization headers, or
application credentials are forwarded. Recipe JSON-LD ingredients are preferred;
otherwise navigation, scripts, advertisements and boilerplate are stripped from
the visible main content. At most 20,000 sanitized characters, explicitly marked
as untrusted data, reach the model. The HTML and extracted page text are never
stored; only the submitted URL remains as provenance, so there is no page cache
or cache TTL to configure.

Text accompanying a URL is authoritative context. Images and the page are
supporting evidence; the extraction prompt requires conflicts to lower
confidence or create a warning rather than silently inventing a quantity. The
result stops at the same structured component schema used by text and images.
Page nutrition totals are intentionally discarded: component resolution and the
existing local/Open Food Facts/consented-web chain supply nutrition, application
code calculates totals, and the existing approval policy controls diary writes.
SearXNG remains available only to the downstream resolver/research features when
both `RESEARCH_ENABLED` and the user's research consent allow web research; URL
ingestion itself does not use it for discovery or fallback.

The model decomposes the sentence; it is not asked what a food contains. Each
component it names is then resolved by `src/server/component-resolver.ts`, which
stops at the first step that yields nutrition:

1. **Your own database**, through the same local-first pipeline the food search
   uses - substrings, brands and aliases, not exact equality.
2. **Open Food Facts**, reached by that same pipeline when nothing local is
   convincing, and cached locally as a real food with provenance.
3. **The open web**, only with `RESEARCH_ENABLED` and the per-user consent:
   SearXNG finds a page, the model reads the per-100 g values off it, and a food
   is created carrying that URL.
4. **The model's own numbers**, last and only if it offered any, stored as a
   clearly badged estimate.

Nothing is chosen silently. Open Food Facts is a database of *branded products*,
so a generic word like "Brot" resolves to one specific supermarket loaf. A
component with no nutrition behind it is reported as skipped rather than logged
as zero calories.

Gram weights prefer what the chosen food actually knows, in this order:

1. **A stated weight or volume** — "80 g Haferflocken" is 80 g.
2. **A serving the food names** — "2 Scheiben" against a `Scheibe` serving of
   30 g is 60 g, and picking a bread with a 45 g slice makes it 90 g.
3. **The food's portion weight** — Open Food Facts labels its serving after the
   amount ("30 g"), never "Scheibe", so a portion word it does not name still
   uses its serving weight. Without this step "2 Scheiben Brot" resolved to no
   weight at all and could not be logged however well the bread matched.
4. **The model's estimate** — a portion size is an interpretation of the
   sentence, while a serving weight is a fact about a food, so this comes last.

A result over 5 kg is treated as a misread unit and falls through to the next
step rather than logging it.

#### Approving, or not

By default a proposal is applied to the diary as soon as the worker finishes it,
because the review screen used to be reachable *only* through the redirect that
followed submitting a meal: navigate away and the proposal was unreachable, so a
queued meal quietly became a meal that was never logged. Everything logged is
still recorded on the proposal, every value still carries its provenance, and an
estimate is still stored as an estimate.

Turn **Settings → Log AI meals automatically** off to approve each one by hand.
Proposals then wait on the dashboard with a one-click **Accept**, and the review
screen is only needed to pick a different food for a component.

Nothing reaches the diary until a human approves it. On approval, only the
components matched to a food already in the database are logged, each freezing
its own nutrition snapshot; a component the matcher could not resolve is
reported as skipped rather than guessed at. A job that fails is retried up to
`maxRetries` times (2 by default) before it is marked failed, and an
administrator can hand it a fresh budget from `/admin`. A reason that cannot
change between attempts — a source page over the size limit, a deleted recipe, a
model that is not installed — fails immediately instead of spending the budget
and holding up the queue.

#### Reading a failed job in the admin panel

`/admin` classifies every failure rather than only storing its message, so
"Ollama request failed" is now separated into *timed out*, *unreachable*, *error
from Ollama* and *model not installed*, each with the underlying cause chain
(`TypeError: fetch failed → Error: connect ECONNREFUSED …`) under **Show
details**. Every attempt is kept, so a job that failed three different ways is
distinguishable from one that failed the same way three times — `errorMessage`
alone only ever held the last of them.

The same panel manages the queue: filter by status, select rows (select all /
select none), then run again, cancel or delete the selection. Four sweeps act on
a whole status — run all failed again, requeue stuck, delete failed, delete
completed. **Requeue stuck** is the one to reach for after a worker crash: a job
the worker had claimed stays `RUNNING` for ever, because nothing in the queue
loop reclaims it.

#### Worker container health

The image runs the app or the worker depending on `NUTRICORE_PROCESS`, and its
healthcheck (`docker/healthcheck.sh`) switches with it. The worker serves no
HTTP, so the previous HTTP-only healthcheck could never pass: the container sat
in `health: starting` and then went `unhealthy`, which is what kept a TrueNAS
stack in **Deploying** even while the worker was processing jobs. The worker now
writes a heartbeat on every queue poll and the healthcheck reads it, allowing a
single job the full `OLLAMA_TIMEOUT_SECONDS` budget plus a margin before calling
a busy worker unhealthy. A deployment that defines its own healthcheck for the
worker service should use `["CMD", "./healthcheck.sh"]`.

`AI_MODEL` selects one model, by name, from those already installed there.
There is no list of models in the compose file because NutriCore neither
downloads nor manages them; adding one would only duplicate state that lives on
the Ollama host. The admin panel's diagnostics reports whether the configured model is
actually installed on the instance NutriCore can reach — it reads the same
`AI_BASE_URL` and `AI_MODEL` the AI client uses, so a green row always refers to
the instance that actually serves requests.

`OLLAMA_BASE_URL` and `OLLAMA_MODEL` are the superseded spelling of the same two
settings. They are still honoured when `AI_BASE_URL` / `AI_MODEL` are unset, so
an existing deployment keeps working, but new ones should set only the `AI_*`
pair. Do not set both to different values.

Any Ollama model works. `qwen3.5:4b` is only the default; a small instruct model
is usually the right fit, because both workflows need reliable structured JSON
rather than long reasoning.

If the Ollama container lives in a different compose stack, attach its network
to the `app` service — see the commented `networks` block in
`docker-compose.yml`. Do not hardcode IP addresses.

#### Why a job used to hang, and what changed

Three things made AI jobs fail or never finish on a CPU-only Ollama host, and
they are worth knowing about because the symptoms were indistinguishable:

- **A hidden five-minute ceiling.** The request did not stream, so Ollama sent no
  response headers until generation had finished, and Node's HTTP client aborts a
  request whose headers have not arrived within its own 300-second deadline -
  whatever `OLLAMA_TIMEOUT_SECONDS` said. At roughly 12 tokens a second that made
  every longer answer impossible to deliver. The request now streams, so
  `OLLAMA_TIMEOUT_SECONDS` is once again the only limit that applies.
- **No ceiling on the answer.** A JSON schema with an open-ended object or a long
  array becomes a grammar under which the model is never obliged to stop.
  `OLLAMA_MAX_OUTPUT_TOKENS` (default 2048) is that ceiling; an answer stopped by
  it is reported as *Answer cut off*, not as malformed JSON.
- **Reasoning eating the whole budget.** A hybrid reasoning model emits its chain
  of thought before the grammar-constrained JSON, in its own `thinking` field,
  and those tokens count against the same ceiling. A six-word quick meal spent
  1950 tokens and 161 seconds thinking and never reached the JSON. Requests now
  send `think: false`, and when a model ignores that the panel says how much of
  the budget was reasoning rather than answering.
- **Validation stricter than the code needed.** The grammar enforces shape only -
  llama.cpp ignores numeric ranges and string lengths - so a model that did not
  know a gram weight wrote `0`, and the whole meal was rejected over one value.
  Answers are now repaired before validation (`src/server/ai-repair.ts`): an
  unusable value is dropped, never replaced with a guess, and the component is
  reported as skipped exactly as before.

Two queue properties matter alongside them. `AiJob.priority` decides what the
worker takes next, in three bands written by `jobPriority`: recipe creation (20)
first, then everything else a user is waiting for (10), then background
enrichment (0). Enrichment sits at the bottom because a chronological queue put
every quick meal behind an entire backfill sweep; recipe creation sits at the top
because it is the longest run the worker has and the one whose page a user is
watching fill in, so waiting behind a few quick meals reads as a broken import.
Ties within a band are still served oldest first. And the worker reclaims a job
left `RUNNING` by a worker that died - a claim is conditional on `QUEUED`, so
otherwise nothing ever picked it up again.

The compose file passes configuration through `env_file: .env` and sets only
`DATABASE_URL` and `NUTRICORE_PROCESS` under `environment:`. That is deliberate:
`environment:` overrides `env_file:`, so a default written into the compose file
would silently win over the value in `.env`.

Setting `AI_ENABLED=false`, or turning AI off per user in Settings, means no
request ever leaves the server for AI purposes.

### AI food search

When a search finds nothing, food search offers **Start AI research**. The model
reconstructs the dish as a list of ingredients with quantities and states the
nutrition of the finished dish per 100 g. Nutrition is then resolved in this
order, and the review screen always says which of the three it used:

1. **Calculated** from database foods, when every ingredient resolved. These are
   real values from real foods and are preferred whenever they are available.
2. **Model-estimated**, when an ingredient is not in the database. Stored as an
   estimate with a reduced confidence score.
3. **Partially calculated**, only when the model supplied no nutrition of its
   own. Per-100 g values then describe the matched part of the dish alone.

A result that yields no nutrition at all cannot be accepted: it would land in
the diary as a 0 kcal entry. Nothing is ever stored without confirmation, and an
accepted result is always marked as an AI estimate.

AI food search needs `AI_ENABLED` (default `true`), a reachable Ollama with the
configured model, and the per-user AI switch in Settings. It does **not** need
`RESEARCH_ENABLED`: estimating from the model alone sends nothing to the web.
Runs are rate-limited per user, and they run in the worker: starting one takes
you straight to the result page, which fills itself in when the run finishes.

### Web research

Disabled by default (`RESEARCH_ENABLED=false`), and additionally requires the
per-user "Allow web research" switch. It only adds the ability to give a run
source URLs — AI food search works without it. A source that cannot be fetched
is reported on the review screen and the run continues with the remaining
sources. When enabled, retrieved pages are treated as untrusted data: only
HTTP(S) URLs on standard ports, DNS resolved and checked against loopback,
private, link-local and carrier-grade-NAT ranges, time-limited, stripped of
scripts and markup, and delimited so page text is never read as instructions.
Only the first 512 KB of a page is read and the rest is abandoned mid-transfer;
a larger page is used up to that point rather than rejected, since only the
first 20,000 characters of text ever reach a prompt.

## Food sources

NutriCore searches several databases, in an order that depends on the user's
language, and stops as soon as it has a good enough answer. Two of them ship
with the application and need no network at all.

| Source | Ships with the app | Responsibility |
| --- | --- | --- |
| Your own foods and recipes | — | Everything you created, plus the public foods a previous lookup already stored |
| **BLS 4.0** | yes, 7,140 foods | Generic German foods. The German national nutrient database |
| **USDA FoodData Central** | yes, 8,156 foods | Generic English/US foods. Optionally extended over the FDC API |
| **Open Food Facts** | no | Branded and packaged products, and every barcode |
| **FatSecret** | no | Optional verified fallback, off by default |

### The order sources are asked in

German text search:

```
Local / your own foods
        |
    BLS 4.0                  (bundled, no network)
        |
 Open Food Facts
        |
   FatSecret                 (only if enabled)
        |
USDA FoodData Central
```

English text search:

```
Local / your own foods
        |
USDA FoodData Central        (bundled, then the API if a key is set)
        |
 Open Food Facts
        |
   FatSecret                 (only if enabled)
```

Barcode, in every language:

```
Local cache / your own foods
        |
 Open Food Facts
        |
   FatSecret                 (only if its plan supports barcodes)
```

A barcode identifies one packaged product, so the generic ingredient databases
are never asked for one: BLS and the USDA generic releases hold no barcodes,
and querying them would only add latency to a scan.

Two rules keep this predictable:

* **Tier order decides which source is asked.** It lives in
  `src/providers/food-sources.ts`, as one map per locale, so adding a language
  is a new entry rather than a language check spread through the code.
* **Ranking decides how the answers are ordered.** It lives in
  `src/lib/ranking.ts` and is a deterministic weighted sum. It is deliberately
  too small a term to override an identity match, so a better-trusted generic
  food can never displace the branded product you actually scanned.

Traversal stops when a result both matches exactly — a barcode, a name, a
synonym or an official translation — and carries at least three of the four
primary nutrients (`src/server/food-search-policy.ts`). A merely *similar*
result never stops it, which is why a German search for a branded product
still reaches Open Food Facts. Typing never reaches a network provider at all:
only an explicit request for remote results or a complete barcode does.

A source that is unreachable is skipped, with the results from earlier tiers
kept and the next tier still consulted. A provider outage degrades the result
list; it never fails the search.

### How long each source may be kept

Persistence is a licensing question before it is a caching question, so it
belongs to the source (`PersistencePolicy` in `src/providers/food.ts`):

| Source | Policy | Effect |
| --- | --- | --- |
| BLS, USDA | permanent | Imported into PostgreSQL and kept |
| Open Food Facts | permanent | Unchanged behaviour; ODbL permits it, and an expired answer is still served during an outage |
| FatSecret | cache with TTL | Content expires after 24 hours and is pruned once no diary entry, favourite or recipe references it. An expired answer is *not* served during an outage |

### Importing the bundled databases

The upstream downloads in `datasets/raw` (291 MB of .xlsx and JSON) are a build
input, not a runtime dependency. They are converted once into about 5 MB of
gzipped NDJSON in `datasets/bundled`, which is what ships:

```bash
npm run datasets:convert        # regenerate datasets/bundled after a new release
npm run db:import:foods         # import into PostgreSQL (idempotent)
npm run db:import:foods -- bls  # just one of them
```

The import is safe to repeat: it compares the artifact's checksum against the
last import and stops immediately when nothing has changed, and it finds each
food again by its own identifier (a BLS code, an FDC id) and updates it in
place — so food ids, diary entries and recipe ingredients all stay valid. A
food that a newer release no longer lists is counted and left alone rather than
deleted.

You do not normally have to run anything: the worker imports the bundled
databases in the background on start-up, and **Administrator Panel → Food
databases** shows what is bundled versus imported, with a button to import or
force a re-import.

### What the importers do and do not assume

* BLS marks a nutrient it never determined with the string `-`, a trace with
  `TR`, and a value below the detection or quantification limit with
  `<LOD`/`<LOQ`. All four stay unknown; none of them ever becomes `0`. A zero
  BLS states as a fact (`Logische Null` — there is no alcohol in oats) is kept
  as a real zero.
* Units are converted explicitly and only between known pairs. BLS states
  sodium in mg where NutriCore stores g, and copper, manganese and vitamin B6
  in µg where NutriCore stores mg. A future release that changes a unit fails
  the import instead of rescaling every value by a thousand.
* Both importers record the source's own number and unit alongside the
  converted value, so a conversion stays auditable.
* Nutrients whose mapping is uncertain are not mapped. BLS 4.0 publishes no
  selenium and no trans fat; FDC publishes no total omega-3, omega-6 or salt;
  FatSecret's calcium, iron, vitamin A and vitamin C have been published both
  as masses and as percentages of a daily value, so NutriCore imports none of
  them. In every case the nutrient stays unknown rather than becoming a guess.
* Names come from the source. BLS supplies an official German and English name
  for all 7,140 of its foods, so a German user reads German and an English user
  reads English; slash-separated synonyms
  ("Speisesalz/Siedesalz/Tafelsalz") become searchable aliases. Nothing is
  machine-translated, and a branded product is never translated at all.

## Database migrations, upgrade, backup and restore

The container runs `prisma migrate deploy` at start-up. It deliberately does
**not** run `prisma db push`, which can drop columns to force the live database
to match the schema.

Migrations also install the nutrient catalogue, which is reference data rather
than demo data: every stored nutrient value has a foreign key onto it, so a
database without it cannot hold a single food. Adding a nutrient means adding it
to `src/lib/nutrients.ts` **and** shipping a migration; a test fails if the two
drift apart. The optional development seed is only ever about sample foods,
diary entries and a demo account.

```sh
# Upgrade
docker compose pull && docker compose up -d --build

# Backup
docker compose exec -T db pg_dump -U nutricore -Fc nutricore \
  > "${BACKUP_PATH:-./backups}/nutricore-$(date +%F).dump"

# Restore into an empty database
docker compose exec -T db pg_restore -U nutricore -d nutricore --clean --if-exists \
  < backups/nutricore-YYYY-MM-DD.dump
```

Back up before every upgrade, test restores periodically, and keep a copy off
the server. A bind-mounted backup on the same pool is not a backup.

### A migration that failed

Prisma records a migration that failed and then refuses to apply any later one,
which shows up as `Error: P3009` in the app **and** the worker log, both of them
restarting for ever:

```
migrate found failed migrations in the target database, new migrations will not
be applied. The <name> migration started at <time> failed
```

Each migration is applied to PostgreSQL inside a transaction, so a failed one
left nothing of itself behind. The start-up script therefore marks it rolled
back and applies it again, once, which recovers the stack by itself as soon as
an image carrying the corrected migration is pulled. Should the second attempt
fail too, start-up stops with the database error that caused it - fix the
migration rather than the record of it. The same recovery by hand:

```sh
docker compose run --rm --entrypoint sh app -c \
  'node ./node_modules/prisma/build/index.js migrate resolve --rolled-back <name>'
```

## Development

```sh
npm install
cp .env.example .env          # set APP_SECRET and POSTGRES_PASSWORD
docker compose up -d db
npx prisma migrate deploy
npm run db:seed               # optional demo data; refuses to run in production
npm run dev
```

## Testing

```sh
npm run check      # lint + typecheck + unit/integration tests
npm test           # Vitest only
npm run test:e2e   # Playwright; starts the production server itself
```

Unit tests cover the Mifflin-St Jeor equations and safety limits, TDEE,
kcal/kJ, g/kg, sodium/salt, per-100 g and serving scaling, recipe totals and
yields, unknown-value handling, coverage, rounding, locale formatting, the
ranking function, moving averages, the OFF and Ollama adapters, the research
schema and state machine, confidence scoring, the SSRF guard and CSV escaping.

Integration tests run against a real PostgreSQL database and assert that one
user cannot read or delete another user's foods, diary entries or weight
history, and that account deletion removes every personal record. Set
`TEST_DATABASE_URL` to enable them; they skip cleanly without it.

One of them replays the whole migration history into a scratch database seeded
with the rows a running installation holds - including rows written by versions
that have since been replaced. Applying migrations to an empty database, which
is all a plain `migrate deploy` in CI does, cannot catch a data migration that
only fails on real data.

End-to-end tests cover registration, onboarding, the transparent target,
sign-in failure, creating and logging a food, editing a portion, unknown values
rendering as a dash, day navigation, switching language, switching theme,
export and diagnostics.

`RATE_LIMIT_MULTIPLIER` exists only so the E2E suite can register many accounts
from one address. Leave it unset in production.

## Data sources and licensing

**Open Food Facts** database content is available under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/); the
individual contents are under the Database Contents License. Product images
carry their own licence terms. Cached OFF records keep their provider id and
retrieval timestamp so they remain identifiable as OFF-derived. Redistributing a
database derived from OFF may carry share-alike obligations.

**USDA FoodData Central** data is generally public domain (CC0) and is
attributed regardless. The Foundation Foods and SR Legacy releases are bundled
with the application.

**Bundeslebensmittelschlüssel (BLS) 4.0** is Germany's national nutrient
database, developed and maintained by the
[Max Rubner-Institut](https://www.mri.bund.de/), the German Federal Research
Institute of Nutrition and Food. Its own documentation lists among the changes
for version 4.0 a provision free of charge and free of licence
("kostenfreie und lizenzfreie Bereitstellung") and states no restriction on
redistribution. Obtained from <https://blsdb.de/download>; the version bundled
here is **BLS 4.0, data release 2025**, recorded in
`datasets/bundled/manifest.json` with a checksum of both the source files and
the converted artifact.

**FatSecret** is optional and off by default. Its Platform API terms do not
permit building a copy of their database, which is why NutriCore caches
FatSecret content for 24 hours and prunes it, rather than storing it the way it
stores the sources above.

This is operational documentation, not legal advice. The same information is
shown in the app at `/about/data-sources`. Add your own licence in `LICENSE`.

## Body scanning

An opt-in two-view capture estimates body circumferences from a front and a side
photograph. It runs on CPU in about 80 ms per scan, needs no GPU, no model
weights and no third-party service, and nothing leaves the server.

It is an estimate, never a measurement, and it is **not validated**: it reads
the outline of a body and reports what that outline implies, with a range. No
body-fat, muscle, water or bone value is produced from a photo. Every value is
reviewed by hand before it is recorded, and a rejected capture produces no
numbers at all.

The images are held only until the worker has read them - at most ten minutes,
swept every minute - and are deleted in the same transaction that stores the
estimates. Because this stack has no object storage they live in Postgres until
then, so a `pg_dump` taken inside that window can contain one; the same is true
of meal and recipe-import photos. See [docs/BODY_SCAN.md](docs/BODY_SCAN.md) for
the capture conditions, the privacy design and what would have to be measured
before any accuracy claim.

Scanning needs a height in the user's profile, which is the only thing that sets
the scale. Each of the two views is captured through two buttons - one asks the
phone for its camera, the other always opens the device's file picker - so a
photo taken earlier can be used without the camera taking over. Live camera
capture additionally needs an HTTPS origin; on a plain-HTTP LAN deployment both
buttons open the file picker and everything else works the same.

## Sharing recipes

Off by default in the only sense that matters: nothing is shared until you open
one of your recipes and publish it. There is no feed of anything else, no
profiles, no comments, and no ranking - just the recipes members of this
installation have chosen to publish, newest first, at **Foods → Shared
recipes**.

Publishing takes a **snapshot**. The title, description, instructions and tags
are yours to edit in the publish form before anything is public, and what is
published is that text, the ingredient names with their amounts, and the
nutrition calculated from them. Your display name is shown as the author. Your
private recipe is not touched, and no food row of yours becomes readable: a
publication deliberately stores no food ids, because `Food.ownerId` is the
whole boundary between two members and a shared id would give it away.

Saving somebody's shared recipe **copies** it:

- you get your own recipe, owned by you;
- each ingredient resolves to a food you may already read - the shared provider
  row it was made with, matched by provider id or barcode;
- an ingredient with no such row (the author's own custom food) becomes a
  private food of yours, marked `IMPORTED`, carrying the snapshot's values;
- the nutrition is recalculated by the same code path a manual edit uses.

Nothing the author does afterwards reaches your copy. They can edit, withdraw
or delete the original and your recipe is unaffected - which is the entire
reason for copying rather than linking.

One case is refused rather than fudged. A food from a source whose licence
allows caching but not storage (FatSecret, see
[How long each source may be kept](#how-long-each-source-may-be-kept)) may be
re-used while the shared row still exists, but its values are never copied into
somebody's permanent private food. When that row has already been pruned, the
ingredient is left out of your copy and named on the recipe, rather than
quietly turning expiring provider content into a permanent public dataset.

An AI draft cannot be published: confirm it first. Withdrawing takes a
publication out of the list and out of reach by its address, but leaves the
copies other members saved alone - they are their recipes now, and an author
changing their mind is not a reason to strip the credit off them.

Publishing is rate limited per account. Everything here is instance-local:
there is no public access, no federation and no discovery beyond the members of
this installation.

## Security considerations

- Argon2id password hashing with OWASP-aligned parameters
- Opaque session tokens; only SHA-256 hashes are stored
- HTTP-only, SameSite=Lax cookies, `Secure` when `APP_URL` is HTTPS
- Same-origin validation on state-changing route handlers
- Rate limiting on sign-in, registration, search, export and research
- Zod validation on every input, provider response and AI output
- Ownership checks on every user-owned entity
- SSRF protection with DNS resolution and private-range blocking
- Secrets only from the environment, never logged, never shown in the UI
- No advertising SDKs, no third-party analytics, no telemetry
- Uploaded photos are validated by their bytes, not their filename or declared
  type, held for minutes at most and swept by the worker
- A published recipe carries no food ids, so sharing cannot expose the author's
  private food rows; a saved copy only ever references foods the recipient may
  read

Report the usual caveats: run behind a reverse proxy with TLS, keep the host
patched, restrict access to a trusted network, and rotate `APP_SECRET` if it is
ever exposed (this invalidates existing sessions).

## Deferred to Phase 2

These have interfaces, schemas and unit tests, but no user-facing flow yet:
web research provider search (source URLs are supplied by hand today), browser
barcode scanning (manual entry works), adaptive TDEE, photo/voice input, meal
planning, household sharing and offline sync.

The FatSecret adapter is complete and unit tested, but it has not been
exercised against the live Platform API — no account was available — so treat
its first enablement as a configuration exercise and check
**Administrator Panel → Diagnostics**, which reports the IP-allowlist refusal
that a self-hosted deployment is most likely to hit.
