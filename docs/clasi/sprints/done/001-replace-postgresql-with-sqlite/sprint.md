---
id: '001'
title: Replace PostgreSQL with SQLite
status: done
branch: sprint/001-replace-postgresql-with-sqlite
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
todo: docs/clasi/todo/replace-postgres-with-sqlite.md
---

# Sprint 001: Replace PostgreSQL with SQLite

## Goals

Switch the entire application data layer from PostgreSQL to SQLite. The
database engine, ORM dialect, session store, Docker topology, secrets
configuration, tests, and developer docs must all reflect the new single-file
database approach. After this sprint, no Postgres dependency — runtime,
driver, or tooling — should remain in the codebase.

## Problem

The project was bootstrapped from a template that defaults to PostgreSQL 16 +
Drizzle ORM (node-postgres driver) + a Postgres-backed session store
(connect-pg-simple). The current deployment topology runs a separate `db`
Docker container and stores a `db_password` as a Docker Swarm secret. This is
heavyweight for a single-node application that has no need for Postgres-only
features (LISTEN/NOTIFY, GIN indexes, JSONB, FOR UPDATE SKIP LOCKED). SQLite
eliminates the separate DB service, the db_password secret, and all Postgres
driver dependencies while keeping Drizzle ORM as the query layer.

## Solution

1. Swap Drizzle's dialect from `postgresql` to `sqlite` in schema, config, and
   DB initialization code.
2. Replace Postgres-specific schema constructs (`pgTable`, `pgEnum`, `serial`,
   `timestamp`, `json`, `uuid`) with their SQLite equivalents.
3. Delete the existing Postgres migration history and produce a single clean
   SQLite init migration.
4. Replace `connect-pg-simple` session store with `better-sqlite3`-backed
   session storage (or fall back to MemoryStore for dev/test).
5. Remove the `db` service from Docker Compose; mount a SQLite file on a
   named volume.
6. Drop `db_password`, `DATABASE_URL` (postgres-format), and `db_port` from
   secrets, `.devcontainer`, and startup scripts.
7. Replace `wait-for-db.sh` (Postgres readiness probe) with a no-op or remove
   it — SQLite files are always available on mount.
8. Update all tests (db layer and server layer) from `drizzle-orm/node-postgres`
   to `drizzle-orm/better-sqlite3`.
9. Update all docs to remove Postgres references and reflect SQLite conventions.

## Success Criteria

- `npm run dev` starts without a Postgres container.
- `npm run test:db` and `npm run test:server` pass against SQLite.
- No `pg`, `connect-pg-simple`, or `drizzle-orm/node-postgres` imports remain
  in application or test code.
- `drizzle.config.ts` declares `dialect: 'sqlite'`.
- `config/dev/public.env` and `config/prod/public.env` use `DATABASE_URL=file:...`.
- All docs accurately describe the SQLite-based stack.

## Scope

### In Scope

- Drizzle schema rewrite: `pgTable` → `sqliteTable`, enum simulation, type mapping
- Drizzle config rewrite: dialect, driver, credentials
- DB initialization module: swap `drizzle-orm/node-postgres` + `pg` Pool for
  `drizzle-orm/better-sqlite3` + `Database` constructor
- SQLite migration: delete Postgres migrations, generate fresh SQLite init migration
- Session store: replace `connect-pg-simple` with `better-sqlite3` session store
  or MemoryStore; remove `pg` Pool from `server/src/index.ts`
- Docker Compose: remove `db` service, add SQLite volume mount to `server` service
- `docker/dev-server-start.sh`: remove `wait-on tcp:db:5432`, replace migration
  command with `drizzle-kit migrate`
- `docker/wait-for-db.sh`: remove (no longer needed)
- `docker/entrypoint.sh`: remove `DB_PASSWORD` handling if it remains
- `devcontainer.json`: update `DATABASE_URL`, remove `DB_PASSWORD`/`DB_PORT`,
  remove port 5432 forward, remove `Prisma.prisma` extension
- `config/dev/public.env` and `config/prod/public.env`: update `DATABASE_URL`
- `config/rundbat.yaml`: remove `container_template`/`database_template` if
  Postgres-specific; update notes
- `config/sops.yaml` / `.sops.yaml`: remove `db_password` key if present
- `secrets/dev.env*` / `secrets/prod.env*`: remove `DB_PASSWORD` / `db_password`
- `server/package.json`: remove `pg`, `connect-pg-simple`, `@types/pg`,
  `@types/connect-pg-simple`; add `better-sqlite3`, `@types/better-sqlite3`
- `tests/db/*.test.ts`: rewrite to use `drizzle-orm/better-sqlite3`
- `tests/server/*.test.ts`: replace `drizzle-orm/node-postgres` + `Pool` imports
- `AGENTS.md`: update Database Engineer section, remove Postgres philosophy
- `CLAUDE.md`: update stack table and Postgres references
- `docs/template-spec.md`: update stack, DB philosophy, patterns, secrets, deployment
- Developer docs (`docs/setup.md`, `docs/deployment.md`, `docs/secrets.md`) if they
  reference Postgres, db_password, or port 5432

### Out of Scope

- Changing business logic, routes, or services (beyond mechanical DB driver swaps)
- Adding new features or schema changes beyond the SQLite migration
- Migrating existing production data
- Changing the auth strategy or session cookie behavior
- Any frontend changes

## Test Strategy

Each test file in `tests/db/` and `tests/server/` currently instantiates a
`pg.Pool` directly. After the rewrite, they will use `Database` from
`better-sqlite3` with an in-memory (`:memory:`) or temp-file database. The
server test files that only import `drizzle-orm/node-postgres` for the DB
fixture need the import swapped; no logic changes are expected. The db-layer
tests (`schema.test.ts`, `pike13Schema.test.ts`) exercise constraints and
round-trips — these will run in-memory against the fresh SQLite schema.

## Architecture Notes

- SQLite is embedded: there is no network socket to wait for. `wait-for-db.sh`
  becomes obsolete and should be deleted.
- Sessions: `connect-pg-simple` requires a live Postgres connection. The
  simplest SQLite-compatible replacement for production is
  `better-sqlite3-session-store` (wraps the same `better-sqlite3` driver already
  used for the main DB). For tests, MemoryStore is already used.
- UUID columns: SQLite has no native UUID type. Drizzle's `text()` column stores
  UUIDs as strings; default generation switches from `defaultRandom()` (Postgres)
  to a JavaScript `crypto.randomUUID()` default.
- Timestamps with timezone: SQLite stores all timestamps as UTC text or integer.
  Drizzle's `integer({ mode: 'timestamp' })` is the idiomatic choice.
- Enums: SQLite has no native enum type. Replace `pgEnum` + enum columns with
  `text()` columns and TypeScript union types or `check` constraints.
- JSON columns: SQLite supports `TEXT` for JSON. Drizzle's `text({ mode: 'json' })`
  handles serialization transparently.
- The `sessions` table (currently `pgTable` with `json('sess')` and
  `timestamp('expire')`) needs to be re-declared in sqliteTable form if the
  session store still uses it directly.

## GitHub Issues

(none)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On |
|---|-------|------------|
| 001 | Drizzle Schema Rewrite (pg-core → sqlite-core) | — |
| 002 | DB Init Module and Server Session Store | 001 |
| 003 | Drizzle Config and Migration Reset | 001 |
| 004 | Docker Compose and Startup Scripts | 003 |
| 005 | Remove pg Dependencies and Update Package Files | 002, 004 |
| 006 | Rewrite DB-Layer Tests | 001, 003 |
| 007 | Rewrite Server-Layer Tests | 002, 006 |
| 008 | Update Docs and Developer Configuration | 004, 005 |

Tickets execute serially in the order listed.
