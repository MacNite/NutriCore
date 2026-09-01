# NutriCore

Privacy-first, self-hosted food, calorie and nutrition tracking for a private
server. No ads, no analytics, no subscription. Nutrition data carries explicit
provenance, and a value that is unknown stays unknown rather than becoming zero.

NutriCore is a TypeScript modular monolith: Next.js serves the responsive PWA
and the API, Prisma owns the PostgreSQL schema, and provider modules isolate
external data and AI behind adapters.

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
- **Weight tracking** — entries, chart with a 7-day moving average and goal
  line, plus an accessible text summary and table.
- **Settings** — profile, target override, language, AI and research toggles.
  Secrets are never displayed.
- **Administration** — for the `ADMIN` role only: invite users with single-use
  links, activate and deactivate accounts, watch the AI job queue with its
  retries and errors, and check service reachability (diagnostics). Reachable
  from Settings → Administration.
- **Export** — versioned JSON of all personal records, plus diary and weight
  CSV. Credentials are excluded.
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
src/providers/  External adapters (Open Food Facts, Ollama)
src/i18n/       Locale resolution
messages/       de.json / en.json translation catalogues
prisma/         Schema, migrations and the optional development seed
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
accounts should normally be invited. No demo account is ever created
automatically.

**Administration** lives at `/admin`, reachable from Settings → Administration
for accounts with the `ADMIN` role. It invites users, activates and deactivates
accounts, and shows the AI job queue. NutriCore sends no email: creating an
invitation shows the single-use link once, on that page, for the administrator
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
| `OLLAMA_TIMEOUT_SECONDS` | no | Model generation timeout; default `600` seconds |
| `USDA_ENABLED` / `USDA_API_KEY` | no | Phase 2 |
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
SearXNG is intentionally not bundled:
point `SEARXNG_URL` at the operator's existing instance with JSON output enabled.
`SEARXNG_URL` itself selects SearXNG; do not set `RESEARCH_PROVIDER` for it.

**Every AI feature is asynchronous.** Submitting one inserts a record and an
`AiJob` and returns immediately; nothing waits for Ollama. That covers all four:
a free-text meal (`MEAL_INPUT`), logging a recipe to the diary (`RECIPE_LOG`),
AI food research (`RESEARCH`), and creating a recipe from a link, an image or
free text (`RECIPE_IMPORT`). Backfilling missing nutrition (`FOOD_ENRICHMENT`)
is background work and runs behind all of them - see the priority note below.
The review pages refresh themselves while the worker is busy, so a queued job
does not look like a broken one.

The worker performs local canonical matching first, uses SearXNG only for source
discovery, and stores a pending human-review proposal.

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
- **Validation stricter than the code needed.** The grammar enforces shape only -
  llama.cpp ignores numeric ranges and string lengths - so a model that did not
  know a gram weight wrote `0`, and the whole meal was rejected over one value.
  Answers are now repaired before validation (`src/server/ai-repair.ts`): an
  unusable value is dropped, never replaced with a guess, and the component is
  reported as skipped exactly as before.

Two queue properties matter alongside them. `AiJob.priority` puts work a user is
waiting for ahead of background enrichment, because a chronological queue put
every quick meal behind an entire backfill sweep. And the worker reclaims a job
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
attributed regardless.

This is operational documentation, not legal advice. The same information is
shown in the app at `/about/data-sources`. Add your own licence in `LICENSE`.

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

Report the usual caveats: run behind a reverse proxy with TLS, keep the host
patched, restrict access to a trusted network, and rotate `APP_SECRET` if it is
ever exposed (this invalidates existing sessions).

## Deferred to Phase 2

These have interfaces, schemas and unit tests, but no user-facing flow yet:
web research provider search (source URLs are supplied by hand today), the
USDA adapter, browser barcode
scanning (manual entry works), adaptive TDEE, photo/voice input, meal planning,
household sharing and offline sync.
