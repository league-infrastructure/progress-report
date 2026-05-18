---
id: '002'
title: Admin Users API endpoints
status: done
use-cases:
- SUC-002
depends-on:
- '001'
github-issue: ''
todo: admin-access-and-management.md
completes_todo: false
---

# Admin Users API endpoints

## Description

There is no API for managing admin users. This ticket adds three routes to
`server/src/routes/admin.ts` — list, add, and remove — all protected by the
existing `isAdmin` middleware. These routes are the backend for the Admin Users
page added in ticket 003.

Depends on ticket 001 because ticket 001 may add the first admin row; the API
tests reference the same `adminSettings` table.

## Acceptance Criteria

- [ ] `GET /api/admin/users` returns `{ email: string; createdAt: string }[]`
      from `adminSettings`, ordered by `createdAt` ascending.
- [ ] `POST /api/admin/users` with `{ email: string }` inserts a new row;
      returns 201 with the created record.
- [ ] `POST /api/admin/users` returns 409 if the email is already present.
- [ ] `POST /api/admin/users` returns 400 if `email` is missing or not a string.
- [ ] `DELETE /api/admin/users/:email` removes the row; returns 200.
- [ ] `DELETE /api/admin/users/:email` returns 409 if `:email` matches
      `req.session.user!.email` (self-removal blocked).
- [ ] `DELETE /api/admin/users/:email` returns 404 if the email is not found.
- [ ] All three routes return 401 for unauthenticated requests (enforced by
      `isAdmin` middleware already applied to `adminRouter`).

## Implementation Plan

### Approach

Append three route handlers to `adminRouter` in `admin.ts`. No new files needed.

### Files to Modify

- `server/src/routes/admin.ts` — add three handlers after the existing Slack routes

### Implementation Detail

Add the following imports to `admin.ts` (if not already present):

```typescript
import { adminSettings } from '../db/schema';
```

Add three handlers:

**GET `/api/admin/users`:**
```typescript
adminRouter.get('/admin/users', async (_req, res, next) => {
  try {
    const rows = await db
      .select({ email: adminSettings.email, createdAt: adminSettings.createdAt })
      .from(adminSettings)
      .orderBy(adminSettings.createdAt);
    res.json(rows.map((r) => ({ email: r.email, createdAt: r.createdAt?.toISOString() })));
  } catch (err) { next(err); }
});
```

**POST `/api/admin/users`:**
```typescript
adminRouter.post('/admin/users', async (req, res, next) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'email (string) is required' });
      return;
    }
    const normalized = email.trim().toLowerCase();
    const existing = await db
      .select({ id: adminSettings.id })
      .from(adminSettings)
      .where(eq(adminSettings.email, normalized));
    if (existing.length > 0) {
      res.status(409).json({ error: 'Already an admin' });
      return;
    }
    const [created] = await db
      .insert(adminSettings)
      .values({ email: normalized })
      .returning();
    res.status(201).json({ email: created.email, createdAt: created.createdAt?.toISOString() });
  } catch (err) { next(err); }
});
```

**DELETE `/api/admin/users/:email`:**
```typescript
adminRouter.delete('/admin/users/:email', async (req, res, next) => {
  try {
    const targetEmail = decodeURIComponent(req.params.email).toLowerCase();
    if (targetEmail === req.session.user!.email) {
      res.status(409).json({ error: 'Cannot remove your own admin access' });
      return;
    }
    const deleted = await db
      .delete(adminSettings)
      .where(eq(adminSettings.email, targetEmail))
      .returning();
    if (deleted.length === 0) {
      res.status(404).json({ error: 'Admin not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});
```

Note: `eq` is already imported in `admin.ts`. Add `adminSettings` to the
existing schema import destructure.

### Testing Plan

**New tests** (`tests/server/adminUsers.test.ts`):

Use Supertest against the Express app with a test SQLite DB. Seed one admin
row before each test.

- `GET /api/admin/users` — unauthenticated → 401; authenticated admin → 200
  with array.
- `POST /api/admin/users` — happy path → 201; duplicate → 409; missing body
  → 400.
- `DELETE /api/admin/users/:email` — happy path → 200; self-removal → 409;
  not found → 404; unauthenticated → 401.

**Existing tests to run:** `npm run test:server`
