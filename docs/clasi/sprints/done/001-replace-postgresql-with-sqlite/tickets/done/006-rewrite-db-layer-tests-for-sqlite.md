---
id: '006'
title: Rewrite DB-Layer Tests for SQLite
status: done
use-cases:
- SUC-002
- SUC-006
depends-on:
- '001'
- '003'
github-issue: ''
todo: ''
completes_todo: false
---

# Ticket 006: Rewrite DB-Layer Tests for SQLite

## Description

Rewrite `tests/db/schema.test.ts` and `tests/db/pike13Schema.test.ts` to use
`drizzle-orm/better-sqlite3` and an in-memory SQLite database instead of a
live Postgres connection. The test logic (what is being tested — constraints,
round-trips, uniqueness) is preserved exactly; only the DB fixture setup
changes.

## Acceptance Criteria

- [x] `tests/db/schema.test.ts` imports from `drizzle-orm/better-sqlite3` and
      `better-sqlite3`; no `pg` or `drizzle-orm/node-postgres` import.
- [x] `tests/db/pike13Schema.test.ts` has the same import changes.
- [x] Both test files use `:memory:` as the SQLite database path (no file I/O
      required for test runs).
- [x] The SQLite schema DDL is applied to the in-memory database in `beforeAll`
      using a migration helper (see implementation notes).
- [x] All existing test assertions pass (no test logic changes, only driver
      changes).
- [x] `npm run test:db` passes with no Postgres instance running.
- [x] No `DATABASE_URL` environment variable is required to run `npm run test:db`.

## Implementation Plan

### Approach

The DB-layer tests currently follow this pattern:

```typescript
pool = new Pool({ connectionString: process.env.DATABASE_URL });
db = drizzle(pool, { schema });
```

Replace this in both test files with:

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

let sqlite: InstanceType<typeof Database>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema });
  // Apply the migration to create tables in-memory
  migrate(db, { migrationsFolder: path.resolve(__dirname, '../../server/drizzle') });

  // Clean up any leftover test data (same delete calls as before)
  db.delete(schema.volunteerHours);
  // ... etc.
});

afterAll(() => {
  sqlite.close();
});
```

Note: `migrate()` from `drizzle-orm/better-sqlite3/migrator` is synchronous.
The `beforeAll` does not need to be `async` if the only async operation was
the Postgres pool setup.

### Migration helper path

The `migrationsFolder` must point to `server/drizzle/` (which will contain
the single `0000_init.sql` from Ticket 003). Use `path.resolve` relative to
the test file location.

### Cleanup pattern

The current tests call `await db.delete(schema.X)` — these are async Drizzle
calls even in the node-postgres driver. With `better-sqlite3`, Drizzle's
operations are synchronous but still return promises (for API consistency).
The `await` calls will continue to work.

### Files to Modify

- `tests/db/schema.test.ts` — replace fixture setup (10-15 lines at top)
- `tests/db/pike13Schema.test.ts` — same replacement

### Testing Plan

- `npm run test:db` — must pass with no external database.
- Confirm in test output that all assertions run (not skipped).

### Documentation Updates

None required for this ticket.
