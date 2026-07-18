# ---- Base ----
FROM node:22-alpine AS base
RUN apk add --no-cache openssl
WORKDIR /app

# ---- Build ----
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
# Strip devDependencies (local delete, no network — fast)
RUN npm prune --omit=dev

# ---- Production ----
FROM base AS production
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

# Prisma CLI is a devDep but needed for migrations at startup
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/ts-node ./node_modules/ts-node
COPY --from=build /app/node_modules/typescript ./node_modules/typescript

EXPOSE 3000

CMD npx prisma migrate deploy && node dist/src/main.js