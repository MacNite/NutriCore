# NutriCore

Privacy-first, self-hosted nutrition tracking for households. NutriCore is a
TypeScript modular monolith: Next.js serves the responsive PWA and API, Prisma
owns the PostgreSQL schema, and provider modules isolate external data and AI.

## Features

- German and English dashboard, diary, food search, recipes, progress and settings
- Explicit nutrition provenance and immutable diary nutrition snapshots
- Mifflin-St Jeor target calculation, nullable nutrient arithmetic and coverage
- Local foods plus throttled Open Food Facts barcode/search adapter
- Structured, confirm-before-save Ollama food research workflow
- Password accounts with Argon2 hashing and signed, HTTP-only sessions
- JSON/CSV export-ready data model, weight tracking and favorites
- Light/dark/system themes and installable PWA metadata

## Requirements and quick start

Docker 25+ with Compose is the supported production path:

```sh
cp .env.example .env
# Set APP_SECRET to at least 32 random characters
docker compose up -d --build
```

Open <http://localhost:3000>; health is at <http://localhost:3000/api/health>.
No demo account is created in production.

## Architecture

The App Router UI and route handlers live in `src/app`, domain code in
`src/lib`, provider adapters in `src/providers`, and the normalized tenant-aware
schema in `prisma/schema.prisma`. Diary entries retain JSON snapshots, so source
updates cannot rewrite history. Missing nutrient values remain unknown.
See [architecture details](docs/ARCHITECTURE.md).

## TrueNAS SCALE

Create datasets for PostgreSQL and backups, set `POSTGRES_DATA_PATH` and
`BACKUP_PATH` in `.env` to their absolute mount paths, then deploy the Compose
file as a custom application. The app container runs as an unprivileged user;
PostgreSQL is not published outside the Compose network by default.

## Configuration

All variables are documented in `.env.example`. `APP_SECRET` and database
credentials are required. Open Food Facts defaults on. Ollama is external to
this stack: set `AI_ENABLED=true`, `OLLAMA_BASE_URL` (for example
`http://ollama:11434`) and `OLLAMA_MODEL=deepseek-r1`. USDA and web research are
opt-in and require their respective keys. Secrets are never returned by the
diagnostics UI.

## Database migrations, upgrade, backup and restore

The container runs `prisma migrate deploy` before starting. To upgrade, back up,
pull the new release and run `docker compose up -d --build`.

```sh
# backup
docker compose exec -T db pg_dump -U nutricore nutricore | gzip > "${BACKUP_PATH:-./backups}/nutricore.sql.gz"
# restore into an empty database
gunzip -c backups/nutricore.sql.gz | docker compose exec -T db psql -U nutricore nutricore
```

Test restores periodically. Bind-mounted backups are not a substitute for an
off-server copy.

## Development and testing

```sh
npm install
cp .env.example .env
docker compose up -d db
npx prisma migrate dev
npm run dev
npm run check       # lint, typecheck, unit/integration tests
npm run test:e2e    # requires a running app and Playwright browser
```

Optional seed data is explicitly installed with `npm run db:seed`; it is never
run by the production entrypoint.

## Data sources and licensing

Open Food Facts database content is available under ODbL and requires
attribution; product images may use different licenses. Cached OFF records stay
identified as OFF-derived. Redistributing a derived database may have
share-alike implications. USDA FoodData Central is attributed even where data is
public domain/CC0. This is operational documentation, not legal advice. The same
information is shown at `/about/data-sources`.

## Privacy and security

NutriCore includes no ads, analytics, or telemetry. External calls occur only
for configured food lookup/research. AI receives the requested food description,
not the diary. Research URLs are HTTP(S)-only, DNS checked against private
networks, size/time limited, and fetched content is treated as untrusted data.
Use TLS at the reverse proxy, keep dependencies patched, rotate secrets, and
restrict access to the trusted network.

## Deferred Phase 2

Adaptive TDEE, image/voice recognition, wearable integrations, household recipe
sharing, advanced trends/planning, and full offline synchronization remain
interface-level extension points rather than incomplete user-facing features.
