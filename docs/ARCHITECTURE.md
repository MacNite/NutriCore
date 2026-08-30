# Architecture and trust boundaries

NutriCore is a modular monolith. Route handlers authenticate and authorize the
tenant before calling domain services; provider responses and AI output are
validated at their boundary. Public provider foods have no owner, while every
personal entity has a user relation. Historical diary JSON contains normalized
nutrition and provenance snapshots.

Canonical food values use an explicit amount and mass/volume unit. Serving
records may map named units to grams or milliliters; volume conversion requires
stored density. The normalized nutrient definition/value model permits new
micronutrients without a schema migration and nullable values preserve unknowns.

Search runs barcode, local exact/personal/usage/fuzzy, cached provider and only
then remote lookup. Deterministic ranking imposes a penalty on AI. PostgreSQL
`pg_trgm` supports the local index; the application should debounce remote calls.

AI research is a persisted state machine. Ollama must return schema-constrained
ingredients, assumptions, sources and confidence. Ingredient nutrition is then
resolved from trusted food records and calculated locally. `AWAITING_CONFIRMATION`
is mandatory before acceptance. Web retrieval is an independent, read-only
provider and must reject private/reserved DNS/IP targets, constrain redirects,
timeouts and bytes, strip active markup, and delimit excerpts as untrusted.

Sessions use random opaque tokens, store only token hashes, and are delivered in
Secure/HttpOnly/SameSite cookies. Mutations require same-origin/CSRF validation.
Authentication and research handlers are rate-limited. Deployment terminates TLS
at the administrator's reverse proxy.
