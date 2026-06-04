# Local Development Setup

## Prerequisites

- Node.js 20 LTS
- npm 10+
- (Optional) Docker + Docker Compose for Docker dev mode
- (Optional) SOPS + age for decrypting secrets

## 1. Install dependencies

```bash
# From the repo root:
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

## 2. Set up environment variables

**Option A — Decrypt with SOPS (requires age key):**
```bash
sops -d secrets/dev.env > .env
```

**Option B — Manual (local dev or Codespaces):**
```bash
cp secrets/dev.env.example .env
# Edit .env and fill in required values
```

**Minimum required variables for local dev:**

```env
DATABASE_URL=file:./data/dev.db
SESSION_SECRET=any-random-string-for-local-dev

APP_DOMAIN=localhost:5173

PIKE13_CLIENT_ID=<your Pike13 OAuth client ID>
PIKE13_CLIENT_SECRET=<your Pike13 OAuth client secret>
PIKE13_CALLBACK_URL=http://localhost:3000/api/auth/pike13/callback
PIKE13_API_BASE=https://jtl.pike13.com/api/v2/desk
```

Optional (features degrade gracefully if not set):
```env
ANTHROPIC_API_KEY=...       # AI review drafts + Slack bot NLP
GITHUB_TOKEN=...            # GitHub commit fetching (avoids rate limits)
SENDGRID_API_KEY=...        # Email delivery
SENDGRID_FROM_EMAIL=...     # From address
SLACK_BOT_TOKEN=...         # Slack DMs and bot
SLACK_SIGNING_SECRET=...    # Slack event verification
SLACK_REVIEWS_CHANNEL=...   # Channel for compliance reports
PIKE13_TEST_PERSON_ID=...   # Pike13 person ID for test note delivery
```

## 3. Create the data directory

```bash
mkdir -p server/data
```

## 4. Start the dev server

```bash
npm run dev
```

This runs `drizzle-kit migrate` (applies pending migrations), then starts the backend on port 3000 and the Vite frontend on port 5173.

- Frontend: http://localhost:5173
- API: http://localhost:3000/api
- Health: http://localhost:3000/api/health

## Test users (local only)

When `NODE_ENV=test`, the server exposes `POST /api/auth/login` which accepts a persona name without Pike13 OAuth:

```bash
# Log in as admin
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"persona": "admin"}'

# Log in as instructor
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"persona": "instructor"}'
```

Available personas: `admin`, `instructor`, `inactive`

## Docker dev mode

```bash
npm run docker:up    # Start all services in Docker Compose
npm run docker:logs  # Tail logs
npm run docker:down  # Stop
```

The Docker Compose dev config maps the SQLite data to a local volume and exposes the same ports.

## Running migrations manually

```bash
cd server
npx drizzle-kit migrate
```

To generate a new migration after changing `server/src/db/schema.ts`:

```bash
cd server
npx drizzle-kit generate
npx drizzle-kit migrate
```

## Running tests

```bash
cd server
npm test              # All server tests (Jest + Supertest)
npm run test:watch    # Watch mode
```

Tests use an in-memory or temp SQLite file and do not require a running server.

## Troubleshooting

**`Cannot find module 'better-sqlite3'`**
Run `cd server && npm install`.

**Port 3000 already in use**
Kill the existing process: `lsof -ti:3000 | xargs kill -9`

**`APP_DOMAIN is required`** error on login redirect
Set `APP_DOMAIN` in `.env` (no `http://` prefix).

**Pike13 OAuth redirect mismatch**
`PIKE13_CALLBACK_URL` must exactly match the redirect URI registered in your Pike13 OAuth app settings.

**Session not persisting between requests**
Ensure `SESSION_SECRET` is set and not empty. In Docker, verify the `.env` file is mounted.
