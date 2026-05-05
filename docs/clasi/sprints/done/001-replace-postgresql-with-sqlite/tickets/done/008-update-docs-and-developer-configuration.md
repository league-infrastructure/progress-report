---
id: 008
title: Update Docs and Developer Configuration
status: done
use-cases:
- SUC-007
depends-on:
- '004'
- '005'
github-issue: ''
todo: replace-postgres-with-sqlite.md
completes_todo: true
---

# Ticket 008: Update Docs and Developer Configuration

## Description

Update all developer-facing documentation to remove PostgreSQL references and
describe the SQLite-based stack. This is the final ticket in the sprint — it
brings the written docs into alignment with the code that was changed in
Tickets 001-007.

**Note:** `docs/template-spec.md` is the primary doc for the template stack.
`AGENTS.md` and `CLAUDE.md` define the Database Engineer agent and project
conventions. If `docs/setup.md`, `docs/deployment.md`, or `docs/secrets.md`
exist in the project, check them for Postgres references. Also update
`.claude/rules/project-overview.md` (the project overview rule file) if it
references PostgreSQL in the technology stack table.

## Acceptance Criteria

- [x] `CLAUDE.md` stack table shows `SQLite` (not `PostgreSQL 16 Alpine`).
- [x] `CLAUDE.md` does not mention `db_password`, `connect-pg-simple`, or Postgres
      as the default data store.
- [x] `AGENTS.md` Database Engineer section describes SQLite patterns (not Postgres
      JSONB/LISTEN/GIN philosophy). The MongoDB/Redis equivalents table is removed
      or replaced with SQLite-appropriate guidance.
- [x] `docs/template-spec.md` Section 5 (Database) describes SQLite as the data
      store; no "Postgres Does It All" philosophy, no JSONB/GIN/LISTEN patterns.
- [x] `docs/template-spec.md` Section 6 (Docker Architecture) does not describe a
      `db` service; describes the SQLite volume mount.
- [x] `docs/template-spec.md` Section 7 (Secrets) does not list `db_password` as a
      required secret.
- [x] `docs/template-spec.md` Section 12 (Technology Decisions) shows SQLite as the
      database choice with appropriate rationale.
- [x] `.claude/rules/project-overview.md` technology stack table shows SQLite if it
      currently shows PostgreSQL.
- [x] `docs/setup.md` (if it exists) does not reference Postgres container setup or
      `DATABASE_URL=postgres://`.
- [x] `docs/deployment.md` (if it exists) does not reference a Postgres Swarm
      service or `db_password` secret management.
- [x] `docs/secrets.md` (if it exists) does not list `db_password` as a required
      secret.
- [x] No document in `docs/` or agent definition in `AGENTS.md` instructs a
      developer to "push back on MongoDB/Redis and use Postgres JSONB/LISTEN"
      unless it has been updated to reflect the SQLite context.

## Implementation Plan

### Files to Modify

For each file, search for "postgres", "postgresql", "pg", "db_password",
"LISTEN", "NOTIFY", "JSONB", "GIN", "pgTable", "5432" and update each
occurrence to its SQLite equivalent or remove it if no equivalent applies.

#### `CLAUDE.md`

- Stack table: change `PostgreSQL 16 Alpine via Prisma ORM` to
  `SQLite via Drizzle ORM (better-sqlite3)`.
- Note: The CLAUDE.md currently has a line saying "PostgreSQL is the single
  data store — no Redis or MongoDB." Update to:
  "SQLite is the single data store — no separate database service required."

#### `AGENTS.md` — Database Engineer section

Replace the entire "Postgres Does It All" philosophy block. New version:

```
**Owns:** `server/src/db/schema.ts`, `server/drizzle/`, and `tests/db/`.

**Database: SQLite via Drizzle ORM (`drizzle-orm/better-sqlite3`)**

Key conventions:
- Schema declared in `server/src/db/schema.ts` using `drizzle-orm/sqlite-core`.
- Migrations managed by `drizzle-kit generate` / `drizzle-kit migrate`.
- No separate database service — SQLite file is co-located with the server
  on a named Docker volume (`sqlite-data:/app/data`).
- `DATABASE_URL` is `file:<path>` format; e.g., `file:./data/dev.db`.
- Enums are simulated with `text()` columns + TypeScript union types.
- Timestamps stored as integers (milliseconds epoch) using
  `integer({ mode: 'timestamp' })`.
- JSON columns use `text({ mode: 'json' })`.
- UUIDs stored as `text` with `$defaultFn(() => crypto.randomUUID())`.
- WAL mode enabled for better concurrent reads.
```

Remove the MongoDB equivalents table and Redis equivalents table. Replace
with: "SQLite is the single data store. If a use case requires pub/sub or
advanced queuing, evaluate `better-sqlite3` NOTIFY patterns or an in-process
event emitter before introducing an external service."

#### `docs/template-spec.md`

Section 5 (Database):
- Change heading to "SQLite"
- Remove "Postgres Does It All" section
- Replace with SQLite patterns: JSON storage via `TEXT` columns, no
  LISTEN/NOTIFY, WAL mode, `drizzle-kit` migrations
- Remove MongoDB/Redis equivalents tables

Section 6 (Docker Architecture):
- Update the three-environment table: remove `db` container from all rows
- Update Docker files list: remove `wait-for-db.sh`; note SQLite volume
- Remove Swarm secrets pattern for `db_password`

Section 7 (Secrets):
- Remove `db_password` from the required secrets table

Section 12 (Technology Decisions):
- Change database row from PostgreSQL to SQLite with rationale: "Embedded,
  no separate service, zero configuration, sufficient for single-node
  deployment"

#### `.claude/rules/project-overview.md`

Update the technology stack table if it shows `PostgreSQL 16 Alpine via Prisma ORM`.
Change to `SQLite via Drizzle ORM`.

#### `docs/setup.md`, `docs/deployment.md`, `docs/secrets.md` (if they exist)

Run a search; update any Postgres-specific instructions. The `docs/` directory
currently only contains `template-spec.md` and `clasi/` — but verify.

### Testing Plan

No automated tests. Manual review:
- Read each updated doc for internal consistency.
- Confirm no Postgres jargon remains in any operational instruction.
- `grep -r "postgres\|postgresql\|db_password\|5432\|LISTEN.*NOTIFY\|connect-pg" docs/ AGENTS.md CLAUDE.md`
  should return only archive/historical references (e.g., a "before/after"
  comment), not operational instructions.

### Documentation Updates

This ticket IS the documentation update.
