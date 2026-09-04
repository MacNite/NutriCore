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
| Entry | route handlers, server actions | Session, authorisation, validation, rate limiting |
| Services | `src/server` | Diary, foods, targets, export, diagnostics |
| Domain | `src/lib` | Nutrition, calories, units, ranking, research, guards |
| Adapters | `src/providers` | Open Food Facts, Ollama, provider interfaces |
| Storage | `prisma` | Schema, migrations, seed |

## Nutrition model

Canonical values are stored per an explicit `basisAmount` + `basisUnit`
(100 g or 100 ml). A nutrient value of `NULL` means *unknown* and is never
coerced to zero; sums propagate that unknown rather than silently dropping it,
and `sumWithCoverage` reports what fraction of the logged amount actually
carried data so the UI can say "63 % coverage" instead of "0 mg".

`NutrientDefinition` + `FoodNutrient` is a normalised catalogue, so a new
micronutrient is a seed row, not a migration.

Mass and volume are only converted through a stored `densityGPerMl`. Without
one the conversion fails loudly — 1 ml is never assumed to be 1 g. Named
portions ("slice", "Scheibe") must carry a resolved gram or millilitre
equivalent; they are never guessed. Raw and cooked foods are separate records.

Source energy is authoritative. `calculatedEnergyKcal` exists only as a
diagnostic and never overwrites a provider's value.

## Snapshots

A diary entry stores `nutritionSnapshot` and `provenanceSnapshot` as JSON at
logging time. If Open Food Facts changes a product next month, yesterday's diary
is unaffected. Editing an amount rescales from the entry's own frozen per-basis
values rather than re-reading the food, so an edit cannot silently pull in newer
data either.

## Search and ranking

The pipeline is local-first: barcode, exact local match, favourites, recent and
frequent foods, personal recipes and custom foods, cached external foods, fuzzy
matches, and only then a remote provider — which is skipped entirely when a
strong local result already exists. Queries are debounced client-side and
cached server-side for a day. `pg_trgm` GIN indexes back the fuzzy match.

Text search and barcode lookup hit different Open Food Facts services. Search
goes to Search-a-licious (`search.openfoodfacts.org`), the Elasticsearch
service that replaces the legacy `/cgi/search.pl`; barcode lookups go to the
REST API. The legacy endpoint remains as an automatic fallback, and
`OPENFOODFACTS_SEARCH_BACKEND=legacy` pins it. The search index carries only
macronutrients, so its results are marked partial: a partial product adds the
values it knows and never overwrites the ones it does not, which keeps a search
hit from erasing micronutrients an earlier barcode lookup established.

Remote calls are treated as unreliable by design. Outbound requests are paced
below the provider's published per-minute limits (`src/lib/rate-gate.ts`), a
transient failure is retried with a jittered backoff, and when the provider is
still unreachable an expired cache entry is served in preference to an error:
food data that was correct yesterday is a better answer than a banner. Only a
query that has never been answered surfaces the outage to the user, and even
then the local results stay on screen.

Ranking is a deterministic weighted sum, not a model. A barcode match is an
identity match and short-circuits everything. An AI estimate always carries a
penalty scaled by its confidence, so it can never outrank a good exact match
from a trusted database.

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
