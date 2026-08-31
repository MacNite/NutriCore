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

Ranking is a deterministic weighted sum, not a model, and every candidate goes
through it - a provider result is scored on the same signals as a stored one,
not pinned to a flat value. A barcode match is an
identity match and short-circuits everything. An AI estimate always carries a
penalty scaled by its confidence, so it can never outrank a good exact match
from a trusted database. Products sold in the market this instance serves
(`MARKET_COUNTRIES` in `src/lib/ranking.ts`, matched against Open Food Facts
country tags stored on the food) are preferred, never required: the tags are
crowdsourced, so an untagged product keeps its place rather than being demoted.

## AI and research trust boundary

`AIProvider` abstracts the model; `OllamaProvider` is the default. Output is
requested as schema-constrained JSON and always validated with Zod — prose is
never parsed, and a malformed answer is rejected rather than guessed at.
Reasoning-model `<think>` blocks are stripped before parsing.

Research is a persisted state machine. Every path to `ACCEPTED` runs through
`AWAITING_CONFIRMATION`, so nothing is stored without the user confirming it.
The model reconstructs a dish from ingredients with explicit quantities;
nutrition is then calculated deterministically from resolved database foods
rather than invented by the model. Confidence is an interpretable sum of named
signals, and the reasons are shown to the user.

Retrieved web content is untrusted input. `checkUrl` allows only HTTP(S) on
standard ports, rejects embedded credentials, resolves DNS and blocks loopback,
private, link-local, unique-local, carrier-grade-NAT and multicast targets —
which also stops a public hostname that resolves inward. Content is size- and
time-limited, stripped of scripts and markup, and wrapped in a delimiter that
tells the model it is reference data and not instructions.

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
