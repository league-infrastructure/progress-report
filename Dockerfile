# syntax=docker/dockerfile:1.6

# --- Client build ---
FROM node:20-alpine AS client-build
WORKDIR /src/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- Server stage (full deps; prisma generate; keep TS source) ---
FROM node:20-alpine AS server
RUN apk add --no-cache python3 make g++
WORKDIR /src/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate

# --- Runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=server /src/server/node_modules    ./node_modules
COPY --from=server /src/server/src             ./src
COPY --from=server /src/server/prisma          ./prisma
COPY --from=server /src/server/prisma.config.ts ./prisma.config.ts
COPY --from=server /src/server/package.json    ./package.json
COPY --from=server /src/server/tsconfig.json   ./tsconfig.json

# Client static assets — server reads from ./public in production
COPY --from=client-build /src/client/dist      ./public

# SQLite data dir (mount a volume here in compose for persistence)
RUN mkdir -p /app/data

EXPOSE 3000

# Run TS source directly with tsx — avoids ESM extensionless-import issues
# from tsc's bundler-mode output. Migrations + tsx server start.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node_modules/.bin/tsx src/index.ts"]
