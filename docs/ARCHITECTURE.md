# Architecture and trust boundaries

NutriCore is a modular monolith. Requests enter through App Router pages, route
handlers and server actions; each resolves the session and authorises the tenant
before calling a service in `src/server/`. Pure domain logic lives in `src/lib/`
and has no database or network dependency, which is what makes it cheap to test
exhaustively.

## Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| UI | `src/app`, `src/components` | Rendering, forms, accessibility |
| Edge | `src/middleware.ts` | Per-request CSP nonce and security headers, the password-change gate |
| Entry | route handlers, server actions | Session, authorisation, validation, rate limiting |
| Services | `src/server` | Diary, foods, food-dataset import, targets, activities, body measurements and scans, recipes and publications, AI jobs and enrichment, retention, export, diagnostics |
| Domain | `src/lib` | Nutrition, calories, units, ranking, activity METs, body geometry, research, guards |
| Adapters | `src/providers` | Open Food Facts, USDA FoodData Central, FatSecret, Ollama, the body-scan estimator; the food source registry and provider interfaces |
| Storage | `prisma` | Schema, migrations, seed |

## Processes

Three, from two images built out of one Dockerfile.

| Process | Started by | Job |
| --- | --- | --- |
| `app` | `node server.js` (Next.js standalone) | Serves the PWA and the API |
| `worker` | `tsx src/worker.ts`, selected by `NUTRICORE_PROCESS=worker` | Drains the AI queue, sweeps expired images and rate-limit buckets, prunes cache-limited provider foods, applies the retention windows, imports the bundled datasets on start-up |
| `migrate` | `docker/migrate.sh`, from the `migrate` image | Runs `prisma migrate deploy` once and exits |

`app` and `worker` come from the same image and differ only by one environment
variable; both wait on `migrate` completing successfully, so neither can run
against a database that is behind the code. Migrations used to run from each
long-running container's entrypoint, which raced on every start and forced the
Prisma CLI into the image that faces the network. The `migrate` image is now
the only one carrying that CLI, and CI asserts both halves of the split.

The worker serves no HTTP, so it proves liveness with a heartbeat file written
on every queue poll; `docker/healthcheck.sh` reads `NUTRICORE_PROCESS` and
switches between that file and the HTTP probe.

## Nutrition model

Canonical values are stored per an explicit `basisAmount` + `basisUnit`
(100 g or 100 ml). A nutrient value of `NULL` means *unknown* and is never
coerced to zero; sums propagate that unknown rather than silently dropping it,
and `sumWithCoverage` reports what fraction of the logged amount actually
carried data so the UI can say "63 % coverage" instead of "0 mg".

`NutrientDefinition` + `FoodNutrient` is a normalised catalogue, so a new
micronutrient is a seed row, not a migration.

Mass and volume are only converted through a `densityGPerMl`. The resolver
itself never assumes one: without a density the conversion fails loudly, and
1 ml is never taken to be 1 g. Named portions ("slice", "Scheibe") must carry a
resolved gram or millilitre equivalent; they are never guessed. Raw and cooked
foods are separate records.

Where a food is sold by volume and stores no density — which is every liquid
Open Food Facts supplies, as it publishes no such field — `foodPortionContext`
supplies an assumed one from `lib/density.ts` so the food can be used as a
recipe ingredient at all. That assumption is made only for a millilitre basis,
never for a solid, is flagged as `densityEstimated` so a draft can name the
weights resting on it, and is always beaten by a density the food actually
states. Open Food Facts servings that give both measures ("250 ml (258 g)") are
read as a real density and stored.

Source energy is authoritative. `calculatedEnergyKcal` exists only as a
diagnostic and never overwrites a provider's value.

## Snapshots

A diary entry stores `nutritionSnapshot` and `provenanceSnapshot` as JSON at
logging time. If Open Food Facts changes a product next month, yesterday's diary
is unaffected. Editing an amount rescales from the entry's own frozen per-basis
values rather than re-reading the food, so an edit cannot silently pull in newer
data either.

## Food sources and search

### The sources

Five sources, with different responsibilities and different rules about how
long their data may be kept:

| Source | `SourceType` | Reached by | Persistence |
| --- | --- | --- | --- |
| The user's own foods, their recipes as foods, and previously stored public foods | `USER`, `RECIPE`, `AI_RESEARCH`, `IMPORTED`, and stored provider rows | PostgreSQL | permanent |
| Bundeslebensmittelschlüssel 4.0 | `BLS` | PostgreSQL (bundled and imported) | permanent |
| USDA FoodData Central | `USDA` | PostgreSQL (bundled) plus the optional FDC API | permanent |
| Open Food Facts | `OPEN_FOOD_FACTS` | network | permanent, expired answers served during an outage |
| FatSecret | `FATSECRET` | network, optional | cache with a 24 h TTL, then pruned |

Each is a distinct `SourceType`, never a stand-in for another, so provenance
survives into the UI, the diary snapshot and an export.

### Tier order versus ranking

These are two different decisions and they are kept apart:

* **Tier order decides which source is asked**, and lives in
  `src/providers/food-sources.ts` as one map per locale plus one for barcodes.
  A new language is a new entry there and nothing else — deliberately, rather
  than a language check wherever a source is used.
* **Ranking decides how the answers are ordered**, and lives in
  `src/lib/ranking.ts`. It is a deterministic weighted sum, no model.

Ranking cannot subvert tier order, and trust cannot subvert identity: a barcode
match short-circuits ranking entirely, an exact name is worth 500 points, and
the whole source-trust scale spans 100. A slightly better-trusted generic food
therefore cannot displace the product that was actually scanned.

```
German text          English text        Barcode (any locale)

Local/User           Local/User          Local cache
    |                    |                    |
   BLS                  USDA                 OFF
    |                    |                    |
   OFF                   OFF              FatSecret
    |                    |
FatSecret            FatSecret
    |
  USDA
```

A barcode identifies one packaged product, so the generic ingredient databases
are never queried for one — BLS and the USDA generic releases contain no
barcodes at all.

### When the walk stops

`src/server/food-search-policy.ts` holds the one rule, so that how much network
traffic a keystroke causes is readable in a single place rather than emergent
from three components. Traversal stops when a candidate both

* matches by identity — a barcode, an exact name, an exact name-and-brand, an
  exact synonym or an exact official translation — or is a food this user has
  eaten before with a close name, **and**
* carries at least three of the four primary nutrients.

Similarity alone is never enough. "Nutella" is ~0.8 similar to a dozen BLS
nut-spread entries, and if that stopped the walk no German search would ever
reach Open Food Facts. The completeness half is what lets a weak BLS record
fall through to a fuller answer instead of ending the search.

Local tiers always run; a network tier runs only when the UI asked for remote
results or a complete barcode was scanned. Nothing an earlier tier found is
discarded when a later one is consulted — everything is ranked together — so
tiering reduces requests without hiding alternatives. Sources are walked
strictly one after another rather than in parallel, because the point is to
spend fewer requests, not to spend them faster.

A source that fails is recorded, skipped and followed by the next one. The
outcome carries a `tiers` report saying what was consulted, what each
contributed, and why anything was skipped.

### Caching and provider behaviour

TTLs and persistence are per source rather than global. Open Food Facts keeps
its existing behaviour exactly: search answers cached for a day, content for a
week, and an expired answer served in preference to an error, because data that
was correct yesterday beats a banner. FatSecret's terms allow a live cache and
nothing more, so its foods carry `Food.cacheExpiresAt`, an expired answer is
*not* served during an outage, and the worker prunes expired rows once no diary
entry, favourite or recipe references them. A diary entry freezes its own
nutrition and holds its food with `onDelete: SetNull`, so pruning can never
rewrite a logged meal.

Text search and barcode lookup hit different Open Food Facts services. Search
goes to Search-a-licious (`search.openfoodfacts.org`), the Elasticsearch
service that replaces the legacy `/cgi/search.pl`; barcode lookups go to the
REST API. The legacy endpoint remains as an automatic fallback, and
`OPENFOODFACTS_SEARCH_BACKEND=legacy` pins it. The search index carries only
macronutrients, so its results are marked partial: a partial product adds the
values it knows and never overwrites the ones it does not, which keeps a search
hit from erasing micronutrients an earlier barcode lookup established.

Outbound requests are paced below each provider's published per-minute limit
(`src/lib/rate-gate.ts`), a transient failure is retried with a jittered
backoff, and only a query that has never been answered surfaces an outage to
the user — even then the local results stay on screen. Provider secrets are
read inside the adapter that needs them and never reach the browser.

### Bundled databases

`datasets/raw` holds the upstream downloads and is a build input:
`scripts/convert-food-datasets.mjs` turns 291 MB of .xlsx and JSON into about
5 MB of gzipped NDJSON in `datasets/bundled`, plus a manifest recording each
dataset's version and a checksum of both the source and the artifact. Only the
converted artifacts ship in the image; the raw downloads are excluded by
`.dockerignore` and are not under `public/`, which Next.js would serve to the
internet.

`src/server/food-datasets/` imports them. The readers (`bls.ts`, `usda.ts`) map
a source record onto one `ImportableFood` shape and make every semantic
decision — nutrient identity, unit conversion, what a missing value means, what
kind of food it is — where it can be unit tested against the real files.
`import.ts` writes them in chunked transactions, keyed on the source's own
identifier, so a re-run reconciles instead of duplicating and a food keeps its
id and therefore its diary references. The worker runs it in the background on
start-up; an unchanged dataset costs one query.

Values a source did not determine stay `NULL`. BLS distinguishes four kinds of
"no number" — never determined (`-`), traces (`TR`), and below the detection or
quantification limit (`<LOD`/`<LOQ`) — and `FoodNutrient.qualifier` keeps that
distinction rather than flattening it, while a zero the source states as a fact
is kept as a real zero. `FoodNutrient.origin` records how the source obtained
the value, in the source's own vocabulary.

Per-locale names come from `FoodTranslation`: BLS publishes an official German
and English name for every food, so the reader's language decides which is
shown. Nothing is machine-translated, and a branded product is never
translated.

## AI and research trust boundary

`AIProvider` abstracts the model; `OllamaProvider` is the default. Output is
requested as schema-constrained JSON and always validated with Zod — prose is
never parsed, and a malformed answer is rejected rather than guessed at.
Reasoning-model `<think>` blocks are stripped before parsing.

The grammar Ollama derives from a JSON schema constrains *shape only*: llama.cpp
ignores numeric ranges, string lengths and array bounds. Answers therefore pass
through `src/server/ai-repair.ts` before validation. Repair only ever removes or
clamps — an unusable value becomes absent rather than a guess, so a component
with no weight is still reported as skipped instead of being logged as zero. That
is what keeps validation strict about facts while tolerant about what a grammar
cannot promise; rejecting the whole answer over one unknown number was the
stricter-looking option and the worse one.

`src/server/ai-failures.ts` classifies a thrown error by flattening its `cause`
chain — Node's `fetch` reports every transport failure as a bare
`TypeError: fetch failed` — into one of a small set of kinds. Kinds that cannot
change between attempts (an over-sized source, a deleted record, a model that is
not installed) skip the retry budget entirely, and every attempt is recorded on
`AiJobAttempt` so a job that failed three different ways is distinguishable from
one that failed the same way three times.

Approval is a decision, not a screen. `ai-approval.ts` holds the rules and the
writing, shared by the review screen, the one-click accept and the worker; a
proposal is applied automatically unless the user asked to approve each one. What
never changes is what may be logged: a weight and a real source of nutrition, or
a marked estimate, or nothing. The `AiProposal.accepted` record is what makes an
automatic approval as auditable as a manual one.

A component the model names is resolved against sources, never against the model:
`component-resolver.ts` walks local database, then Open Food Facts, then - with
consent - a web page whose values the model merely reads. The model's own numbers
are the last resort and are stored as a badged estimate. Because Open Food Facts
holds branded products, a generic name resolves to a specific one, so candidates
are offered for approval rather than applied: which product supplied a number has
to be visible to the person accepting it. Gram weights prefer the chosen food's
own serving data, and fall back to the model only for the portion reading, which
is interpretation rather than fact.

Every AI feature is a queued `AiJob`, never inline work in a request: a local
model can take minutes, which no page interaction survives. `AiJob.priority`
keeps recipe creation ahead of the other work a user is waiting for and all of
that ahead of background enrichment - the recipe run is the longest one the
worker has and the one a reader is watching a page fill in for - and the worker
reclaims jobs left `RUNNING` by a worker that died, since a claim is conditional
on `QUEUED` and nothing else would ever pick them up.

A run that has not produced its entry is visible where that entry will land.
`ai-placeholders.ts` derives a stand-in from every `QUEUED`, `RUNNING` or recently
`FAILED` job - listed in the meal it will be written into and among the recipes it
will become - tagged AI and draft, and doing nothing but linking back to that run's
review page. It is derived, never stored: the query stops returning it the moment
the job produces its result, so the real diary entry or draft recipe replaces it
with nothing to clean up, and a worker that dies cannot leave a dummy row behind in
the user's own data.

A failed run keeps its stand-in for a week rather than disappearing. When Ollama is
unreachable every job in flight burns its retries against a connection that is not
there and ends `FAILED`, and a stand-in that vanished made that look like work
silently thrown away: no entry, no error, nothing to retry. The row now reads
"failed", names the cause in the terms a submitter can act on, and carries the two
things that can be done about it (`ai-placeholder-actions.ts`, both scoped to the
caller's own failed jobs): ↻ queues the same input again with a fresh retry budget,
and × deletes the run together with the `AiIngestionInput` behind it, so the text,
URL or photo that was submitted is not orphaned in the database behind a row nothing
shows any more. A draft recipe an earlier run produced survives that delete - the
relation is `SetNull` - and only loses its pointer back to the import. A submission
whose only input was a photo cannot be re-run - the photo is deleted the moment its
job fails - and says so instead of offering a button that would fail again; it can
still be discarded.

Research is a persisted state machine. Every path to `ACCEPTED` runs through
`AWAITING_CONFIRMATION`, so nothing is stored without the user confirming it. A
working state and `FAILED` may go back to `REQUESTED` — that is what lets the
worker retry a run through a chain that is otherwise forward-only — but a restart
is never a route into acceptance, and a decision the user made stays made.
The model reconstructs a dish from ingredients with explicit quantities;
nutrition is then calculated deterministically from resolved database foods
rather than invented by the model. Confidence is an interpretable sum of named
signals, and the reasons are shown to the user.

Retrieved web content is untrusted input. `checkUrl` allows only HTTP(S) on
standard ports, rejects embedded credentials, resolves DNS and blocks loopback,
private, link-local, unique-local, carrier-grade-NAT and multicast targets —
which also stops a public hostname that resolves inward. Content is time-limited,
read only up to `MAX_RESEARCH_BYTES` with the remainder abandoned mid-transfer,
stripped of scripts and markup, and wrapped in a delimiter that tells the model
it is reference data and not instructions.

## Activity and the calorie target

An `ActivityEntry` records what was done, for how long, and — snapshotted at the
moment it was saved — the MET value it was scored with, its compendium code, the
body weight the estimate used and the resulting active kilocalories. The library
in `src/lib/activities.ts` is curated from the 2024 Adult Compendium of Physical
Activities, and keeping the codes means any stored estimate can be audited back
to the source. Snapshotting means the reverse of the diary's problem is also
solved: correcting today's weight cannot silently rewrite what last month's run
is said to have cost.

Whether those calories reach the day's allowance is a preference
(`UserProfile.addActivityCalories`, on by default) applied by
`targetWithActivity` at read time, not folded into the stored target. The
Mifflin-St Jeor components in `NutritionTarget` therefore keep meaning exactly
what they meant when they were calculated, and switching the preference changes
what a day shows without rewriting any history.

## Body scanning

A guided two-view capture estimates circumferences from a front and a side
photograph, on CPU, with no model and no third party. It is geometry: a front
view gives breadth at a landmark level, a side view gives depth at the same
level, and the circumference is the perimeter of the ellipse through those axes,
scaled by the declared height. Levels come from the same `BODY_LANDMARKS` the
drawn body figure is built from, so a scan and the figure it feeds cannot drift
apart about where a waist is.

An estimate is never a measurement. A scan writes nothing to `BodyMeasurement`;
it produces `BodyScanEstimate` rows with intervals, and only a person accepting
one on the review screen turns it into a recorded value with `OPTICAL_SCAN`
provenance. A value the reviewer edited is recorded as `MANUAL`, because a
number they typed is their own measurement whatever prompted it. The estimate
survives the decision either way, so a correction stays distinguishable from an
acceptance. Per-value provenance lives in `BodyMeasurement.valueSources`; a
field absent from that map was entered by hand, which is what every row recorded
before scanning existed was.

The captured images are the most sensitive bytes the application holds and are
treated as a transient worker handoff: written to the scan row because this
deployment has no object storage, read exactly once, and cleared in the same
transaction that stores the estimates. `imagesExpireAt` is a ten-minute deadline
that the worker sweeps every 60 seconds, so a crash between reading and writing
still loses them within about a minute; a scan swept before it was processed
becomes `EXPIRED`, because without its images it never can be. The job carries
`maxRetries: 0` for the same reason. Body images never reach the AI provider.

A rejected capture produces no numbers at all, only reasons to retake. Returning
values the system has already said it does not believe invites the one thing
this feature must not do. Upper arms are not estimated at all: a front view
crosses the arms and the torso at one height and nothing in an outline says
where one stops.

`BodyScanProvider` is the seam for a mesh-fitting, learned or vendor estimator
later. Nothing downstream needs a mesh — the progress figure is drawn from
circumferences — so the expensive half of a conventional scanning pipeline is
absent rather than deferred. See `docs/BODY_SCAN.md`.

## Importing from Apple Health and Health Connect

A one-way import of weight and body history. It arrives two ways, and never goes
back out: neither platform exposes its data to a web page or to a server, so
either a person exports a file by hand or something on the device sends the
readings itself.

The file path came first and is described below. The device path is the same
import behind a different door - see [HEALTH_SYNC.md](HEALTH_SYNC.md) and
"Syncing from a device" at the end of this section.

Parsing happens **in the browser**, which is a deliberate inversion of how every
other import here works. An Apple `export.xml` is regularly several hundred
megabytes, and the two body-size limits in `next.config.ts` - both derived from
the image upload policy, one of which truncates rather than rejects - put it far
out of reach of an upload. Reducing on the device also means the rest of that
file, which holds heart rate, sleep, workouts and clinical documents, never
reaches the server: what is posted is the handful of metrics NutriCore stores.

| Piece | Location | Job |
| --- | --- | --- |
| Container | `src/lib/zip-read.ts` | Central directory by ranged `Blob.slice`, entries inflated with `DecompressionStream` |
| Apple | `src/lib/apple-health-export.ts` | Streaming scanner over `<Record>` opening tags |
| SQLite | `src/lib/sqlite-read.ts` | Read-only b-tree walk, record format, overflow pages |
| Health Connect | `src/lib/health-connect-export.ts` | Finds tables by shape, infers units by range |
| Dispatch | `src/lib/health-file.ts` | Decides which of the four shapes a picked file is |
| Rules | `src/lib/health-import.ts` | Units, day bucketing, one-per-day, the import decision |
| Writing | `src/server/health-import.ts` | Plans against the database, then applies the plan |
| Shared entry | `src/server/health-import-ingest.ts` | The schema and the write both doors go through |

No dependency was added for any of it. The zip is opened with
`DecompressionStream`, which browsers have had for years. The database is read
by hand rather than with sql.js, because sql.js is a WebAssembly build of the
whole engine and running it would mean adding `'wasm-unsafe-eval'` to
`script-src` for every page in the application, permanently, so that one
settings screen could read a file. `security-headers.ts` documents a reason for
each exception it makes and that would not have been a good one. The SQLite
*file format* is documented and explicitly stable, which is what makes reading
it by hand reasonable; the *schema* Health Connect puts inside it is neither,
which is why tables are discovered rather than named.

Nothing in an export states its units. Apple exports in whichever the reader
prefers, so kilograms and pounds both appear; Health Connect stores raw numbers
whose scale is not recorded. Units are therefore resolved by range - a weight
column reading 70000 is grams and one reading 70 is kilograms, and no real body
is ambiguous between them - and a column no scale explains is skipped rather
than guessed at. The same range check drops a reading a device produced during a
fault. This is the one heuristic in the feature and it is why the import shows a
preview before writing: the first time somebody learns a column was read at the
wrong scale should not be after three thousand rows are in their weight log.

### What is imported, and what is not

Weight, body fat, height and waist circumference. Muscle mass is deliberately
absent: both platforms offer *lean body mass*, which counts bone, organs and
body water alongside muscle and reads several kilograms high, and writing it
into `BodyMeasurement.muscleKg` would put a number in that column no device ever
measured. Steps are absent because there is nothing here that consumes one.

Nothing is written outward. A NutriCore estimate - an optical-scan
circumference, an RFM body fat, a MET-derived activity energy - is not a
measurement, and Apple's own review guidelines forbid writing inaccurate data
into HealthKit. The two rules agree, so the boundary is simply that this
instance reads and does not write.

### Provenance and the one rule

`WeightEntry.source` is new and defaults to `MANUAL`, which is what every row
recorded before importing existed was, so no backfill is needed.
`MeasurementSource.HEALTH_PLATFORM` is a distinct value from `OTHER_DEVICE`:
whatever device originally produced a reading, what this instance knows is that
a file said so.

The rule the import enforces, in one sentence: **a value somebody typed is never
overwritten by a file.** It is the same rule the body-scan review already
follows - a number a person stands behind outranks one a device produced - and
`WeightEntry.source` had to exist before it could be expressed at all. For body
measurements the existing per-value map does the work: a field absent from
`valueSources` was entered by hand, so no backfill is needed there either.
Height is the one value a file may fill in but never argue with, because a
person states their own.

`decideSample` in `src/lib/health-import.ts` holds that rule, and both the
preview and the write go through it. A preview that counted differently from
what the import then did would be worse than no preview, so there is exactly one
place that decides.

Re-importing is idempotent by construction. `HealthImportRecord` maps a sample's
identity in its export to what was written, so a second run recognises what the
first one did and reports it as unchanged rather than duplicating it. Health
Connect rows carry their own UUID; Apple's export carries none, so the reader
derives one from the record's own fields.

### Syncing from a device

The file import needs a person for every step. A phone syncing on a schedule has
no person and no session, so it carries a long-lived token instead and posts to
`/api/health/samples`. `HealthDeviceToken` holds only the SHA-256 of that token,
exactly as `Session` does, so the table is not a list of live credentials.

What it is not is a second importer. `src/server/health-import-ingest.ts` holds
the sample schema and the call into the planner, and both doors go through it: a
rule enforced on one path and not the other is not a rule. The endpoint is left
with nothing but its own question, which is who is calling.

The platform is fixed when a token is issued rather than declared per request.
Two things follow, both wanted: what a client sends is only its samples, and a
token taken off one phone cannot write records under the other platform's
identity - which matters because `externalId` is only unique within a platform.

`GET` on the same path answers where to resume, per metric, as the last day
already imported. It is inclusive: somebody who weighs themselves twice in a day
produces two samples on it, and the second must not be missed because the first
was stored. Re-reading that day costs nothing, because the import is idempotent
on `externalId` - a client is free to ignore the cursor entirely and re-send its
whole history, and will simply be told it is unchanged.

Two rate limits, kept apart. Per token, loosely, for a device that is working;
per address, tightly and counted in PostgreSQL, for a token that resolves to
nothing. Sharing one bucket would let a broken client behind a shared address
lock out a working device, and would make a valid token a way to spend the
address budget. `lastUsedAt` is refreshed only by a real write, so a client
stuck in `dryRun` does not look healthy.

There is no expiry column. A sync credential that stops working on a date nobody
wrote down is worse than one its owner revokes when they replace the phone, and
`lastUsedAt` is what makes an unused one visible.

Neither platform is reachable without native code on the device: HealthKit needs
an app or a Shortcut, and Health Connect needs an Android app - a wrapped PWA
cannot read it. What this repository ships is the door, not the clients.

## Authorisation

Public provider foods have `ownerId = NULL` and are readable by everyone.
Personal records always carry a user relation, and every query filters on it, so
an unauthorised record is *not found* rather than forbidden. Deleting a user
cascades to every personal record.

## Sessions

Session tokens are 256 bits of randomness, delivered in an HTTP-only,
SameSite=Lax cookie and stored only as a SHA-256 hash, so a database leak does
not hand out live sessions. `Secure` follows from `APP_URL`, which keeps a
plain-HTTP LAN deployment usable while an HTTPS deployment always gets it.
Server actions carry their own origin validation; route handlers that mutate
state call `assertSameOrigin`.

## Rate limiting

Two limiters, chosen by what the limit is for.

`src/lib/rate-limit.ts` is a fixed window in process memory. It paces search and
outbound provider calls, where a limit that resets with the process is a
politeness measure and nothing more.

`src/server/durable-rate-limit.ts` is the same fixed window held in
PostgreSQL, one `RateLimitBucket` row per key, and it carries the limits that
exist to stop somebody: sign-in, registration, invitation redemption. The whole
decision is a single `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so two
concurrent callers cannot both read a count under the limit and both write it;
the same statement resets an elapsed window, so an expired row needs no cleanup
pass to become usable again. Rows are pruned by the worker only to keep the
table small. In memory, every restart handed an attacker a fresh allowance —
and a self-hosted box restarts whenever its operator upgrades an image. If the
database cannot be reached the in-memory limiter is the fallback, because
failing open on sign-in is worse than a limit that is merely per-process.

Sign-in is limited per account as well as per address, so the limit does not
depend on `TRUSTED_PROXY_HOPS` having been set correctly. `X-Forwarded-For` is
read only as far as that setting allows, counted from the right of the chain,
which is what stops a client choosing its own bucket.

## Retention

`src/server/retention.ts` holds the windows for the records that had none, and
the worker applies them on its slow cadence. Uploaded imagery was always
transient — an explicit expiry, cleared on processing, swept every minute — but
ingestion text, job diagnostics and spent invitations accumulated for ever.

Ingestion text and source URLs are *emptied* rather than deleted, because
`Recipe.importId` points at the row and that link is the provenance saying a
recipe came from an import. Finished AI jobs are deleted with their attempts and
proposal; failed ones are kept three times as long, because a failure is what
somebody eventually asks about. Accepted, revoked or expired invitations are
deleted, and a live one is never touched whatever its age. Every window is
configurable and `0` disables that sweep. Nothing here touches diary entries,
foods, recipes, weights, activities or body measurements: those are the user's
records, and they go when the user or the account does.

## Recipes

Recipes are personal records and expose a synchronised personal `Food` for the
local-first search pipeline. Ingredient portions are resolved through the same
unit boundary as diary portions. Recipe totals use their resolved weights;
optional `yieldWeightG` is the only representation of cooking loss. Logging a
recipe writes nutrition and provenance directly into an immutable diary
snapshot. Deleting the recipe nulls the diary reference while preserving that
snapshot.

An AI import stores its extraction as a `DRAFT` recipe: listed with the user's
recipes and marked as one the model wrote, but deliberately without the
synchronised `Food`, so nothing unreviewed can be logged. Confirming it runs the
ordinary save - the same resolution, nutrition and `Food` sync a manual edit
does - and only then does it become loggable. Because every ingredient must
resolve through the unit boundary, the import keeps only the units a food can
actually be measured in and reports the rest ("2 EL Olivenöl") for the user to
add; the recipe form offers those same units as a dropdown rather than free
text.

## Publishing a recipe

A `RecipePublication` is a snapshot, not a reference. It stores the title,
description, instructions, tags, ingredient names with their amounts and the
nutrition calculated from them — and deliberately no food ids, because
`Food.ownerId` is the whole boundary between two members and a shared id would
give it away. Saving somebody's publication copies it: each ingredient resolves
to a food the recipient may already read (the shared provider row, matched by
provider id or barcode), and one that resolves to nothing becomes a private
`IMPORTED` food of theirs carrying the snapshot's values. Nothing the author
does afterwards reaches that copy, which is the entire reason for copying rather
than linking.

The one case that is refused rather than fudged is a `CACHE_WITH_TTL` source. A
FatSecret-derived food may be re-used while the shared row still exists, but its
values are never written into somebody's permanent private food; once the row
has been pruned the ingredient is left out of the copy and named on the recipe,
rather than turning expiring provider content into a permanent local dataset.
