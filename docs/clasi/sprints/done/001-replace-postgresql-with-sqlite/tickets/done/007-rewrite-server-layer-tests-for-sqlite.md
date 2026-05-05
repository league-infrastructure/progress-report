---
id: '007'
title: Rewrite Server-Layer Tests for SQLite
status: done
use-cases:
- SUC-003
- SUC-006
depends-on:
- '002'
- '006'
github-issue: ''
todo: ''
completes_todo: false
---

# Ticket 007: Rewrite Server-Layer Tests for SQLite

## Description

Update all test files in `tests/server/` to replace the `drizzle-orm/node-postgres`
+ `pg.Pool` DB fixture with a `drizzle-orm/better-sqlite3` + `better-sqlite3`
in-memory fixture. There are 13 test files in this directory; the change is
structural (fixture setup) rather than logical (test assertions stay the same).

The affected files are those identified in the grep scan:
`email.test.ts`, `pike13Sync.test.ts`, `checkins.test.ts`, `feedback.test.ts`,
`pike13SyncRoute.test.ts`, `reviews.test.ts`, `admin.test.ts`,
`pike13OAuth.test.ts`, `templates.test.ts`, `volunteer-hours.test.ts`
(and any others that import `pg` or `drizzle-orm/node-postgres`).

Test files that already use MemoryStore for sessions (e.g., by checking
`process.env.NODE_ENV !== 'test'`) require no session-related changes.

## Acceptance Criteria

- [x] All files in `tests/server/` import from `drizzle-orm/better-sqlite3`
      and `better-sqlite3`; no `pg` or `drizzle-orm/node-postgres` import
      in any test file.
- [x] All test files use an in-memory SQLite database (`:memory:`) for their
      DB fixture.
- [x] The SQLite schema is applied via `migrate()` in each test file's
      `beforeAll`.
- [x] No `DATABASE_URL` environment variable is required to run `npm run test:server`.
- [x] `npm run test:server` passes with no Postgres instance running.
- [x] All previously passing tests continue to pass.

## Implementation Plan

### Approach

The server tests follow the same pattern as the db tests. For each affected
file, apply the same fixture swap as documented in Ticket 006:

```typescript
// BEFORE
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
// ...
pool = new Pool({ connectionString: process.env.DATABASE_URL });
db = drizzle(pool, { schema });

// AFTER
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
// ...
sqlite = new Database(':memory:');
db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: path.resolve(__dirname, '../../server/drizzle') });
```

Also update `afterAll`:
```typescript
afterAll(() => {
  sqlite.close();
});
```

### Shared fixture helper (optional)

If the fixture setup is truly identical across all 10+ files, consider
extracting it to `tests/server/helpers/db.ts`:

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../server/src/db/schema';
import path from 'path';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: path.resolve(__dirname, '../../server/drizzle'),
  });
  return { sqlite, db };
}
```

Then each test file:
```typescript
const { sqlite, db } = createTestDb();
afterAll(() => sqlite.close());
```

This is optional — either approach satisfies the acceptance criteria.

### Files to Modify

All files in `tests/server/` that contain `from 'pg'` or
`from 'drizzle-orm/node-postgres'`:
- `email.test.ts`
- `pike13Sync.test.ts`
- `checkins.test.ts`
- `feedback.test.ts`
- `pike13SyncRoute.test.ts`
- `reviews.test.ts`
- `admin.test.ts`
- `pike13OAuth.test.ts`
- `templates.test.ts`
- `volunteer-hours.test.ts`

Plus any additional files found by:
```bash
grep -l "from 'pg'\|drizzle-orm/node-postgres" tests/server/*.test.ts
```

### Testing Plan

- `npm run test:server` — all tests pass, no Postgres instance needed.
- `npm run test:db` — confirm Ticket 006 tests still pass (no regression).

### Documentation Updates

None required for this ticket.
