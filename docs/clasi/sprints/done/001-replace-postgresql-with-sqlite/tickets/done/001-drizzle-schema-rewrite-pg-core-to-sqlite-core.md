---
id: '001'
title: Drizzle Schema Rewrite (pg-core to sqlite-core)
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-006
depends-on: []
github-issue: ''
todo: replace-postgres-with-sqlite.md
completes_todo: false
---

# Ticket 001: Drizzle Schema Rewrite (pg-core to sqlite-core)

## Description

Replace all Postgres-specific Drizzle column definitions in
`server/src/db/schema.ts` with their SQLite equivalents. This is the
foundation ticket: every other ticket that touches the DB depends on
the schema being in SQLite form.

The current schema imports from `drizzle-orm/pg-core` and uses types
that SQLite does not support natively: `pgTable`, `pgEnum`, `serial`,
`timestamp`, `json`, `uuid`. These must each be replaced.

## Acceptance Criteria

- [x] `server/src/db/schema.ts` imports only from `drizzle-orm/sqlite-core`
      (and `drizzle-orm` for shared helpers).
- [x] All tables are declared with `sqliteTable` (not `pgTable`).
- [x] `pgEnum` and the `reviewStatusEnum` declaration are removed; the
      `status` column on `monthlyReviews` is a plain `text('status')` column.
      The TypeScript type `'pending' | 'draft' | 'sent'` is exported as a
      named union.
- [x] `serial` primary keys are replaced with
      `integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true })`.
- [x] `boolean(...)` columns are replaced with
      `integer('...', { mode: 'boolean' })`.
- [x] `timestamp(...)` columns (with or without `withTimezone`) are replaced
      with `integer('...', { mode: 'timestamp' })`.
- [x] `json(...)` columns (e.g., `sess` on `sessions`,
      `instructors`/`volunteers` on `volunteerEventSchedule`) are replaced
      with `text('...', { mode: 'json' })`.
- [x] `uuid(...)` column (`feedbackToken` on `monthlyReviews`) is replaced
      with `text('feedback_token')` and a
      `$defaultFn(() => crypto.randomUUID())` default.
- [x] All exported TypeScript types (`User`, `Student`, etc.) are updated to
      reflect the new `$inferSelect` / `$inferInsert` shapes.
- [x] TypeScript compilation (`cd server && npx tsc --noEmit`) passes with no
      errors on the schema file.

## Implementation Plan

### Approach

Edit `server/src/db/schema.ts` in-place. Work table-by-table, applying the
type mapping from the architecture update. The logical structure of the schema
(tables, columns, constraints, indexes) does not change — only the column
type constructors change.

### Type Mapping Reference

| Postgres | SQLite |
|---|---|
| `import { pgTable, pgEnum, serial, text, integer, real, boolean, timestamp, json, primaryKey, unique, uuid } from 'drizzle-orm/pg-core'` | `import { sqliteTable, text, integer, real, primaryKey, unique } from 'drizzle-orm/sqlite-core'` |
| `serial('id').primaryKey()` | `integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true })` |
| `boolean('is_active').notNull().default(false)` | `integer('is_active', { mode: 'boolean' }).notNull().default(false)` |
| `timestamp('created_at').notNull().defaultNow()` | `integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())` |
| `timestamp('start_at', { withTimezone: true })` | `integer('start_at', { mode: 'timestamp' })` |
| `json('sess').notNull()` | `text('sess', { mode: 'json' }).notNull()` |
| `uuid('feedback_token').notNull().defaultRandom()` | `text('feedback_token').notNull().$defaultFn(() => crypto.randomUUID())` |
| `pgEnum('review_status', [...])` | Remove; export `export type ReviewStatus = 'pending' \| 'draft' \| 'sent'` |
| `reviewStatusEnum('status').notNull().default('pending')` | `text('status').notNull().default('pending')` |

### Files to Modify

- `server/src/db/schema.ts` — complete rewrite of imports and column types

### Notes

- `defaultNow()` does not exist in `sqlite-core`; use
  `$defaultFn(() => new Date())`.
- `unique()` and `primaryKey()` constraint helpers are imported from
  `drizzle-orm/sqlite-core` (same API, different package path).
- The `sessions` table's `expire` column stores a `Date`; use
  `integer('expire', { mode: 'timestamp' })`.
- After this ticket, `server/src/db/index.ts` will still reference the
  old `node-postgres` driver and will not compile until Ticket 002.
  That is expected — these two tickets should be implemented together
  in one session or the implementer should be aware that the build is
  temporarily broken between them.

### Testing Plan

- TypeScript compilation: `cd server && npx tsc --noEmit`
- Full test runs require Tickets 002 and 003 to also be complete; defer
  `npm run test:db` and `npm run test:server` to Ticket 007.

### Documentation Updates

None required for this ticket.
