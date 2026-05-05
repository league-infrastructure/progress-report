---
sprint: "001"
status: draft
---

# Sprint 001 Use Cases

## SUC-001: Developer starts the app locally without a Postgres container

- **Actor**: Developer
- **Preconditions**: Node.js and project dependencies installed; `DATABASE_URL`
  in `.env` points to a SQLite file path (`file:./data/dev.db`).
- **Main Flow**:
  1. Developer runs `npm run dev`.
  2. Server starts, opens the SQLite file (creating it if absent), applies
     pending Drizzle migrations.
  3. Vite dev server starts.
  4. Application is fully functional at `http://localhost:5173`.
- **Postconditions**: Application is running with SQLite. No Postgres container
  was started.
- **Acceptance Criteria**:
  - [ ] `npm run dev` completes without error and without requiring `docker compose up db`.
  - [ ] API endpoints respond correctly.
  - [ ] Data persists to the SQLite file across server restarts.

---

## SUC-002: Developer runs database-layer tests against an in-memory SQLite database

- **Actor**: Developer / CI
- **Preconditions**: No external database service running; `better-sqlite3`
  installed.
- **Main Flow**:
  1. Developer runs `npm run test:db`.
  2. Each test file creates an in-memory `Database` instance, applies
     the SQLite schema, and exercises Drizzle queries.
  3. Tests clean up within the in-memory database.
- **Postconditions**: All `tests/db/` tests pass.
- **Acceptance Criteria**:
  - [ ] `npm run test:db` passes with no Postgres instance running.
  - [ ] No `pg` or `drizzle-orm/node-postgres` import appears in `tests/db/`.

---

## SUC-003: Developer runs server-layer tests with a SQLite test fixture

- **Actor**: Developer / CI
- **Preconditions**: No external database service running.
- **Main Flow**:
  1. Developer runs `npm run test:server`.
  2. Each test file instantiates a `better-sqlite3` Database (`:memory:`) and
     a `drizzle-orm/better-sqlite3` client; no `pg.Pool` or Postgres
     connection is created.
  3. Route tests exercise the same acceptance paths as before.
- **Postconditions**: All `tests/server/` tests pass.
- **Acceptance Criteria**:
  - [ ] `npm run test:server` passes with no Postgres instance running.
  - [ ] No `pg` or `drizzle-orm/node-postgres` import appears in `tests/server/`.

---

## SUC-004: Application runs inside Docker without a Postgres service

- **Actor**: Developer (Docker dev mode)
- **Preconditions**: Docker daemon running; `DATABASE_URL` in dev env config
  points to the mounted SQLite file path.
- **Main Flow**:
  1. Developer runs `npm run dev:docker`.
  2. Docker Compose starts only `server` and `client` services (no `db` service).
  3. Server mounts a named volume at the path expected by `DATABASE_URL`.
  4. Drizzle migrations run on startup; app is accessible.
- **Postconditions**: Two containers running (not three). Data persists across
  container restarts via the named volume.
- **Acceptance Criteria**:
  - [ ] `docker compose ps` shows `server` and `client` only.
  - [ ] Application responds to API requests.
  - [ ] Data persists after `docker compose restart server`.

---

## SUC-005: No db_password secret is required for any deployment

- **Actor**: Operator deploying to production
- **Preconditions**: Production Docker Swarm running; SQLite-backed stack file
  available.
- **Main Flow**:
  1. Operator loads secrets (`npm run secrets:prod`); the set does not include
     `DB_PASSWORD` or `db_password`.
  2. Operator deploys the stack.
  3. Server starts, opens the SQLite file from the mounted volume, and runs.
- **Postconditions**: No Postgres secret was created or consumed.
- **Acceptance Criteria**:
  - [ ] `secrets/prod.env.example` does not contain `DB_PASSWORD`.
  - [ ] `config/sops.yaml` does not encrypt a `db_password` key.
  - [ ] Production deployment completes without a `db` Swarm service.

---

## SUC-006: Codebase contains no pg, connect-pg-simple, or node-postgres imports

- **Actor**: CI / Code reviewer
- **Preconditions**: All sprint tickets complete.
- **Main Flow**:
  1. CI runs grep for `drizzle-orm/node-postgres`, `connect-pg-simple`,
     `from 'pg'`, and `require('pg')` across `server/` and `tests/`.
  2. Zero matches are returned.
- **Postconditions**: No Postgres driver code remains.
- **Acceptance Criteria**:
  - [ ] Grep for Postgres driver imports in `server/` and `tests/` returns empty.
  - [ ] `server/package.json` does not list `pg`, `connect-pg-simple`,
        `@types/pg`, or `@types/connect-pg-simple` as dependencies.

---

## SUC-007: Documentation accurately describes the SQLite-based stack

- **Actor**: New developer onboarding
- **Preconditions**: Documentation update ticket complete.
- **Main Flow**:
  1. Developer reads `AGENTS.md`, `CLAUDE.md`, `docs/template-spec.md`,
     and any existing `docs/setup.md` / `docs/deployment.md`.
  2. The Database Engineer agent definition describes SQLite conventions.
  3. Setup instructions do not mention running a Postgres container.
- **Postconditions**: Consistent SQLite narrative across all developer docs.
- **Acceptance Criteria**:
  - [ ] No Postgres-specific DB philosophy (LISTEN/NOTIFY, GIN, JSONB) in
        the Database Engineer agent definition.
  - [ ] Stack tables in `CLAUDE.md` and `AGENTS.md` show SQLite.
  - [ ] `docs/template-spec.md` DB section describes SQLite patterns.
  - [ ] No reference to port 5432, `db_password`, or a `db` container in
        operational documentation.
