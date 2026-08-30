FROM node:22.19.0-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package*.json ./
RUN npm ci
FROM node:22.19.0-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build
FROM node:22.19.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S nutricore -g 1001 && adduser -S nutricore -u 1001 -G nutricore
COPY --from=build --chown=nutricore:nutricore /app/.next/standalone ./
COPY --from=build --chown=nutricore:nutricore /app/.next/static ./.next/static
COPY --from=build --chown=nutricore:nutricore /app/public ./public
COPY --from=build --chown=nutricore:nutricore /app/prisma ./prisma
COPY --from=build --chown=nutricore:nutricore /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=build --chown=nutricore:nutricore /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build --chown=nutricore:nutricore /app/node_modules/prisma ./node_modules/prisma
USER nutricore
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["sh","-c","./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/prisma db push --skip-generate && node server.js"]
