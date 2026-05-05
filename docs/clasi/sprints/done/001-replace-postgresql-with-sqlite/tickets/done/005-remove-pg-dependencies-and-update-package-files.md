---
id: '005'
title: Remove pg Dependencies and Update Package Files
status: done
use-cases:
- SUC-005
- SUC-006
depends-on:
- '002'
- '004'
github-issue: ''
todo: ''
completes_todo: false
---

# Ticket 005: Remove pg Dependencies and Update Package Files

## Description

After Tickets 002 and 004 have replaced all runtime usage of Postgres-related
packages, this ticket performs the final sweep: remove the packages from
`server/package.json`, update environment configuration files, remove
`db_password` from secrets, and update the devcontainer config.

This ticket has no code logic changes — it is a cleanup pass to eliminate
the last package-level and config-level Postgres references.

## Acceptance Criteria

- [x] `cd server && npm ls pg` returns nothing (package not installed).
- [x] `cd server && npm ls connect-pg-simple` returns nothing.
- [x] `server/package.json` does not list `pg`, `connect-pg-simple`,
      `@types/pg`, or `@types/connect-pg-simple`.
- [x] `secrets/dev.env.example` does not contain `DB_PASSWORD`.
- [x] `secrets/prod.env.example` does not contain `DB_PASSWORD`.
- [x] `config/sops.yaml` does not have a `db_password`-related key path
      (if it does, remove it; re-encrypt `secrets/dev.env` and
      `secrets/prod.env` after removing the key).
- [x] `.devcontainer/devcontainer.json` `remoteEnv.DATABASE_URL` is
      `file:./data/dev.db`.
- [x] `.devcontainer/devcontainer.json` does not contain `DB_PASSWORD`,
      `DB_PORT`, or a port-5432 forward.
- [x] `.devcontainer/devcontainer.json` does not list `Prisma.prisma` as a
      VS Code extension.
- [x] `grep -r "from 'pg'\|require('pg')\|drizzle-orm/node-postgres\|connect-pg-simple" server/src/ tests/` returns no matches.

## Implementation Plan

### Step 1: Uninstall server pg packages

```bash
cd server
npm uninstall pg connect-pg-simple @types/pg @types/connect-pg-simple
```

Verify `server/package.json` and `server/package-lock.json` no longer
reference these packages.

### Step 2: Update secrets examples

Edit `secrets/dev.env.example` and `secrets/prod.env.example`: remove the
`DB_PASSWORD=...` line if present (check both files — the scan found no
`db_password` in the example files, but verify).

### Step 3: Update encrypted secrets files

If `secrets/dev.env` or `secrets/prod.env` contain `DB_PASSWORD`:
```bash
sops secrets/dev.env   # opens in editor; remove DB_PASSWORD line; save
sops secrets/prod.env  # same
```
The SOPS re-encryption happens automatically on save.

### Step 4: Update devcontainer.json

Edit `.devcontainer/devcontainer.json`:
- Change `remoteEnv.DATABASE_URL` to `"file:./data/dev.db"`
- Remove `remoteEnv.DB_PASSWORD`
- Remove `remoteEnv.DB_PORT`
- Remove `"5432"` from `forwardPorts`
- Remove `"Prisma.prisma"` from `customizations.vscode.extensions`

### Step 5: Verify no Postgres imports remain

```bash
grep -r "from 'pg'\|require('pg')\|drizzle-orm/node-postgres\|connect-pg-simple" \
  /path/to/project/server/src/ /path/to/project/tests/
```
Expect zero matches.

### Files to Modify

- `server/package.json` — remove pg deps (via npm uninstall)
- `secrets/dev.env.example` — remove DB_PASSWORD if present
- `secrets/prod.env.example` — remove DB_PASSWORD if present
- `secrets/dev.env` (encrypted) — remove DB_PASSWORD via `sops` if present
- `secrets/prod.env` (encrypted) — remove DB_PASSWORD via `sops` if present
- `.devcontainer/devcontainer.json` — update DATABASE_URL, remove DB_PASSWORD/DB_PORT/5432/Prisma

### Testing Plan

- `cd server && npm install && npx tsc --noEmit` — must pass.
- `npm run test:server` — smoke check (full test suite in Ticket 007).
- `grep` verification command from Acceptance Criteria returns empty.

### Documentation Updates

None required for this ticket (docs in Ticket 008).
