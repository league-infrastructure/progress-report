# LEAGUE Report

Monthly student progress review system for The LEAGUE of Amazing Programmers.
Instructors write and send monthly progress emails for their assigned students.
Admins track compliance, volunteer hours, and TA check-ins across the org.

## What it does

- **Instructors** log in via Pike13 OAuth, write monthly reviews for their students, and send them to guardians via Pike13 notes or email. Reviews can be AI-drafted from the student's GitHub commit history.
- **Admins** oversee all instructors, track review compliance, manage volunteer hours, view the schedule, and send Slack or email reminders.
- **Guardians** submit 1–5 star feedback via an unauthenticated public link included in each review.
- **Slack bot** lets instructors generate and send reviews by DM, and automatically reminds instructors about pending reviews on the 1st of each month.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Express 4 + TypeScript (Node.js 20 LTS) |
| Frontend | Vite + React 19 + TypeScript |
| Database | SQLite via Drizzle ORM (`better-sqlite3`) |
| Auth | Pike13 OAuth (`@jointheleague.org` emails only) |
| AI | Anthropic Claude API (review drafts, Slack bot) |
| Email | SendGrid |
| Notifications | Slack Bot API |
| Scheduling | `node-cron` |
| Containerization | Docker Compose (dev), Docker Swarm (prod) |
| Reverse proxy | Caddy |

## Quick Start

```bash
# 1. Install all dependencies
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# 2. Decrypt secrets (requires SOPS + age key)
sops -d secrets/dev.env > .env
# or copy the example and fill in values manually:
cp secrets/dev.env.example .env

# 3. Start the dev server
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000/api
- Health: `curl http://localhost:3000/api/health`

See [docs/setup.md](docs/setup.md) for full setup, Docker dev mode, test users, and troubleshooting.

## Repository Layout

```
client/             Vite + React SPA
  src/
    components/     Reusable UI components
    pages/          Route-level page components
    types/          TypeScript interfaces for API responses

server/             Express API server
  src/
    db/             Drizzle schema and DB connection
    middleware/     Auth guards, error handler
    routes/         Express route handlers (one file per domain)
    services/       Business logic (sync, review generation, Slack, email)
    types/          Session type declarations
  drizzle/          SQL migration files

docs/               Developer documentation
scripts/            Build and deploy shell scripts
config/             rundbat deployment config
secrets/            SOPS-encrypted .env files (dev + prod)
```

## Key npm scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | Start backend + frontend in watch mode |
| `npm run build` | Build server (tsc) and client (vite) |
| `npm run docker:build` | Build and push multi-arch image to GHCR |
| `npm run docker:up` | Start dev stack in Docker Compose |
| `npm run docker:deploy` | Deploy to Docker Swarm (prod) |
| `npm run docker:logs` | Tail Docker Compose logs |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite path — `file:./data/dev.db` local, `file:/app/data/app.db` in Docker |
| `SESSION_SECRET` | Yes | Express session signing secret |
| `APP_DOMAIN` | Yes | App domain without protocol (e.g. `report.jointheleague.org`) |
| `PIKE13_CLIENT_ID` | Yes | Pike13 OAuth app client ID |
| `PIKE13_CLIENT_SECRET` | Yes | Pike13 OAuth app client secret |
| `PIKE13_CALLBACK_URL` | Yes | Full OAuth callback URL |
| `PIKE13_API_BASE` | Yes | Pike13 tenant API root (e.g. `https://jtl.pike13.com/api/v2/desk`) |
| `ANTHROPIC_API_KEY` | No | Enables AI review drafts and Slack bot NLP |
| `GITHUB_TOKEN` | No | GitHub PAT for fetching student commit history (avoids rate limits) |
| `SENDGRID_API_KEY` | No | Enables email delivery of reviews |
| `SENDGRID_FROM_EMAIL` | No | From address for outbound review emails |
| `SLACK_BOT_TOKEN` | No | Enables Slack DMs and the Slack bot |
| `SLACK_SIGNING_SECRET` | No | Verifies Slack event payloads |
| `SLACK_REVIEWS_CHANNEL` | No | Channel ID for posting compliance reports |
| `SLACK_REMIND_DAY` | No | Day of month for scheduled reminders (default: `1`) |
| `PIKE13_TEST_PERSON_ID` | No | Pike13 person ID used by the "Send test note" button |

## Documentation

| Guide | Contents |
|-------|----------|
| [docs/setup.md](docs/setup.md) | First checkout → running dev server |
| [docs/architecture.md](docs/architecture.md) | System design, data flow, and key services |
| [docs/deployment.md](docs/deployment.md) | Production deploy, rollback, troubleshooting |
| [docs/docker-image-build.md](docs/docker-image-build.md) | Docker image build and versioning |

## AI-Assisted Development

This project uses the [CLASI](https://github.com/ericbusboom/claude-agent-skills)
(Claude Agent Skills Instructions) MCP server for structured AI-driven development.

```bash
pipx install git+https://github.com/ericbusboom/claude-agent-skills.git
clasi init
```

Use `/se` in Claude Code for process guidance.

Production URL: `https://report.jointheleague.org`
