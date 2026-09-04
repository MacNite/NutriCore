FROM node:22.19.0-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22.19.0-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# APP_SECRET is only needed to satisfy validation during the build; the real
# value comes from the environment at runtime and is never baked into the image.
RUN npx prisma generate \
 && APP_SECRET="build-time-placeholder-not-a-real-secret" npm run build

# Production dependencies only, so the runtime image carries no build tooling.
FROM node:22.19.0-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

FROM node:22.19.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apk add --no-cache libc6-compat wget \
 && addgroup -S nutricore -g 1001 \
 && adduser -S nutricore -u 1001 -G nutricore

COPY --from=build --chown=nutricore:nutricore /app/.next/standalone ./
COPY --from=build --chown=nutricore:nutricore /app/.next/static ./.next/static
COPY --from=build --chown=nutricore:nutricore /app/public ./public
COPY --from=build --chown=nutricore:nutricore /app/prisma ./prisma
# The converted food databases (BLS 4.0, USDA Foundation and SR Legacy): about
# 5 MB of gzipped NDJSON that `npm run db:import:foods` reads. The 291 MB of
# upstream downloads they were generated from are excluded by .dockerignore -
# they are a build input for scripts/convert-food-datasets.mjs, not a runtime
# dependency.
COPY --from=build --chown=nutricore:nutricore /app/datasets/bundled ./datasets/bundled
COPY --from=build --chown=nutricore:nutricore /app/src ./src
COPY --from=build --chown=nutricore:nutricore /app/tsconfig.json ./tsconfig.json
# Overlay the complete production dependency tree. Prisma's CLI loads
# transitive packages such as `effect` from the top-level node_modules folder
# while applying migrations, so selectively copying only its scoped packages
# produces an incomplete runtime even though the application bundle is present.
COPY --from=prod-deps --chown=nutricore:nutricore /app/node_modules ./node_modules
COPY --chown=nutricore:nutricore docker/entrypoint.sh ./entrypoint.sh
COPY --chown=nutricore:nutricore docker/healthcheck.sh ./healthcheck.sh
RUN chmod +x ./entrypoint.sh ./healthcheck.sh

USER nutricore
EXPOSE 3000
# One image runs both processes, so the check has to know which one it is in.
# A plain HTTP probe marked the worker unhealthy for ever - it serves no HTTP -
# which is what held the whole stack in "Deploying" on TrueNAS. The start period
# covers `prisma migrate deploy`, which runs before either process answers.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD ./healthcheck.sh || exit 1
ENTRYPOINT ["./entrypoint.sh"]
