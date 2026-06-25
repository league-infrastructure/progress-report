# syntax=docker/dockerfile:1.6

# --- Client build ---
FROM node:20-alpine AS client-build
WORKDIR /src/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- Server stage (full deps; build TypeScript output) ---
FROM node:20-alpine AS server
RUN apk add --no-cache python3 make g++
WORKDIR /src/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# --- Runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
LABEL org.opencontainers.image.source="https://github.com/league-infrastructure/progress-report"

COPY --from=server /src/server/node_modules    ./node_modules
COPY --from=server /src/server/dist            ./dist
COPY --from=server /src/server/drizzle         ./drizzle
COPY --from=server /src/server/drizzle.config.ts ./drizzle.config.ts
COPY --from=server /src/server/package.json    ./package.json

# Client static assets — server reads from ./public in production
COPY --from=client-build /src/client/dist      ./public

# Quiz banks + placement assessment — read at runtime by the seeder and the
# placement loader. QUIZ_DATA_DIR points both of them at this absolute path.
COPY Quiz-App/quizzes                          ./Quiz-App/quizzes
ENV QUIZ_DATA_DIR=/app/Quiz-App/quizzes

# SQLite data dir (mount a volume here in compose for persistence)
RUN mkdir -p /app/data

EXPOSE 3000

# Run Drizzle migrations, then start the compiled server.
CMD ["sh", "-c", "node_modules/.bin/drizzle-kit migrate && node dist/index.js"]
