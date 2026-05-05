---
id: '002'
title: DB Init Module and Session Store (SQLite)
status: done
use-cases:
- SUC-001
- SUC-003
- SUC-004
- SUC-006
depends-on:
- '001'
github-issue: ''
todo: ''
completes_todo: false
---

# Ticket 002: DB Init Module and Session Store (SQLite)

## Description

Replace the Postgres driver in the two files that open a database connection
at runtime:

1. `server/src/db/index.ts` — swap `drizzle-orm/node-postgres` + `pg.Pool`
   for `drizzle-orm/better-sqlite3` + `better-sqlite3` `Database`.
2. `server/src/index.ts` — remove `connect-pg-simple` and the `pg.Pool`
   created solely for session storage; replace with a SQLite-compatible
   session store (see implementation notes).

This ticket also adds `better-sqlite3` to `server/package.json` and removes
`pg` and `connect-pg-simple`. Full project-wide dependency cleanup is in
Ticket 005; this ticket removes only what is needed for the server to compile
and start.

## Acceptance Criteria

- [x] `server/src/db/index.ts` imports from `drizzle-orm/better-sqlite3` and
      `better-sqlite3`; no `pg` import remains.
- [x] The exported `db` object is typed as `BetterSQLite3Database<typeof schema>`.
- [x] `DATABASE_URL` is expected in `file:<path>` format; the code strips the
      `file:` prefix before passing to `new Database(path)`.
- [x] WAL mode is enabled: `sqlite.pragma('journal_mode = WAL')`.
- [x] `server/src/index.ts` no longer imports `connect-pg-simple` or `pg`.
- [x] Session store is replaced: either `better-sqlite3-session-store` or
      MemoryStore with a comment documenting the trade-off.
- [x] `server/package.json` `dependencies` includes `better-sqlite3`; does not
      include `pg` or `connect-pg-simple`.
- [x] `server/package.json` `devDependencies` includes `@types/better-sqlite3`;
      does not include `@types/pg` or `@types/connect-pg-simple`.
- [x] `cd server && npm install` completes without native compilation errors.
- [x] `cd server && npx tsc --noEmit` passes.

## Implementation Plan

### Approach

#### `server/src/db/index.ts` — full rewrite

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const dbUrl = process.env.DATABASE_URL ?? 'file:./data/dev.db';
const dbPath = dbUrl.replace(/^file:/, '');

export const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });
```

Exporting `sqlite` allows the session store (and tests) to reuse the same
connection without opening a second file handle.

#### `server/src/index.ts` — session store block

Remove the `connectPgSimple` / `pgPool` block. Two options:

**Option A (recommended for simplicity): MemoryStore**
```typescript
// Session store: MemoryStore (sessions lost on restart).
// Acceptable for single-node deployment; swap for a file-backed store
// if cross-restart session persistence becomes a requirement.
const sessionStore = undefined;
```

**Option B: `better-sqlite3-session-store`**
```typescript
import BetterSQLite3Store from 'better-sqlite3-session-store';
import { sqlite } from './db';
const SQLiteStore = BetterSQLite3Store(session);
const sessionStore =
  process.env.NODE_ENV !== 'test'
    ? new SQLiteStore({ client: sqlite })
    : undefined;
```

The implementer should choose Option A unless the stakeholder has expressed
a need for persistent sessions across server restarts. Option A is simpler
and avoids an additional dependency.

### Files to Modify

- `server/src/db/index.ts` — full rewrite
- `server/src/index.ts` — remove pg session block; add SQLite session store
- `server/package.json` — add `better-sqlite3`; remove `pg`, `connect-pg-simple`,
  `@types/pg`, `@types/connect-pg-simple`

### Notes on Native Compilation

`better-sqlite3` compiles a native Node.js addon during `npm install`.
The existing Docker base images (Node.js 20) include the necessary build
tools. If the build fails with a node-gyp error, install
`python3 make g++` in the Dockerfile build stage.

### Testing Plan

- `cd server && npx tsc --noEmit` must pass (with Ticket 001 done).
- Start the server: `npm run dev:local:server` and confirm
  `GET /api/health` returns 200.
- Full test suite deferred to Ticket 007.

### Documentation Updates

None required for this ticket.
