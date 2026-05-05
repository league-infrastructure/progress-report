---
status: in-progress
sprint: '001'
tickets:
- 001-001
---

# Replace PostgreSQL with SQLite

## Description

Cut PostgreSQL out of the stack and replace it with SQLite as the
single data store for the application.

This is a significant departure from the current template defaults
(Postgres 16 Alpine + Prisma, with JSONB, LISTEN/NOTIFY, and Docker
Swarm secrets for `db_password`). Scope of work likely includes:

- Update Prisma schema `provider` from `postgresql` to `sqlite` and
  reconcile any Postgres-only types (e.g., `Json`/JSONB columns,
  `@db.*` annotations).
- Regenerate migrations against SQLite (existing Postgres migrations
  will not apply).
- Remove the `db` Postgres service from `docker-compose.yml` and
  `docker-compose.prod.yml`; mount a SQLite file via a Docker volume
  instead.
- Drop `db_password` and related secrets from `secrets/`, `.sops.yaml`,
  and `docker/entrypoint.sh`.
- Replace any Postgres-specific code paths: `LISTEN`/`NOTIFY`, raw
  JSONB queries via `prisma.$queryRaw`/`$executeRaw`, GIN indexes,
  `FOR UPDATE SKIP LOCKED` job-queue patterns. Decide on SQLite
  alternatives (in-process events, plain JSON-as-TEXT columns,
  application-level locks) per use case.
- Update `tests/db/` to point at a SQLite test database; remove
  Postgres-specific test setup.
- Update docs: `CLAUDE.md`, `AGENTS.md`, `docs/template-spec.md`,
  `docs/setup.md`, `docs/deployment.md`, `docs/secrets.md`, and the
  Database Engineer agent definition to reflect SQLite.
- Reconsider `rundbat.yaml` deployment topology — SQLite means a
  single-node deployment with a persistent volume; Swarm replication
  is no longer viable for the DB.

This TODO is the first in a series of cleanups the stakeholder plans
for the app.
