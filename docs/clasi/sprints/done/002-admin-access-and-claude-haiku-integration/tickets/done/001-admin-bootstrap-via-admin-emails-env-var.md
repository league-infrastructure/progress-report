---
id: '001'
title: Admin bootstrap via ADMIN_EMAILS env var
status: done
use-cases:
- SUC-001
depends-on: []
github-issue: ''
todo: admin-access-and-management.md
completes_todo: false
---

# Admin bootstrap via ADMIN_EMAILS env var

## Description

The `adminSettings` table is empty on a fresh deployment. There is no way
for the first admin to gain access without direct database manipulation.

This ticket adds an automatic bootstrap: at Pike13 OAuth login time, the
server reads a comma-separated `ADMIN_EMAILS` environment variable and
upserts the authenticated user's email into `adminSettings` if it matches.
This is idempotent — it fires on every login but only writes on the first.

A helper function `bootstrapAdminIfConfigured` is extracted into
`server/src/utils/adminBootstrap.ts` so it can be unit-tested independently
of the full auth route.

## Acceptance Criteria

- [ ] User whose email is in `ADMIN_EMAILS` gets `isAdmin: true` on their next
      login without any manual DB intervention.
- [ ] If `ADMIN_EMAILS` is not set, behaviour is unchanged (no error, no insert).
- [ ] Multiple comma-separated emails all work correctly.
- [ ] Match is case-insensitive (env var value normalised to lowercase before
      comparison).
- [ ] `ADMIN_EMAILS` key is added to `config/dev/public.env` and
      `config/prod/public.env` (commented out with an example value).
- [ ] No schema migration is required.

## Implementation Plan

### Approach

Extract a small helper, call it from the auth callback, add it to the env
var documentation.

### Files to Create

- `server/src/utils/adminBootstrap.ts` — the bootstrap helper

### Files to Modify

- `server/src/routes/auth.ts` — call `bootstrapAdminIfConfigured` before
  the `isAdmin` derivation
- `config/dev/public.env` — add `# ADMIN_EMAILS=email@example.com` comment line
- `config/prod/public.env` — same

### Implementation Detail

**`server/src/utils/adminBootstrap.ts`:**

```typescript
import { db } from '../db';
import { adminSettings } from '../db/schema';

export async function bootstrapAdminIfConfigured(email: string): Promise<boolean> {
  const raw = process.env.ADMIN_EMAILS ?? '';
  const adminEmails = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!adminEmails.includes(email)) return false;
  await db.insert(adminSettings).values({ email }).onConflictDoNothing();
  return true;
}
```

Note: the helper imports `db` directly (same pattern as all other route
modules) rather than accepting it as a parameter, keeping the call site simple.

**`server/src/routes/auth.ts`** — in the Pike13 callback, insert one call
after the token exchange resolves the `normalizedEmail` and before the
`adminSettings` lookup:

```typescript
// Bootstrap admin access if email is in ADMIN_EMAILS env var
await bootstrapAdminIfConfigured(normalizedEmail);

// Determine roles (existing code)
const [adminRow] = await db
  .select()
  .from(adminSettings)
  .where(eq(adminSettings.email, normalizedEmail));
const isAdmin = !!adminRow;
```

The bootstrap call is `await`-ed so any insert error surfaces (it would be
an unexpected DB failure, not an expected conflict — conflicts are ignored).

### Testing Plan

**New tests** (`tests/server/adminBootstrap.test.ts`):

- With `ADMIN_EMAILS=user@example.com` set, calling the helper with
  `user@example.com` inserts a row into `adminSettings` in a test DB and
  returns `true`.
- Calling a second time with the same email does not throw and returns `true`
  (idempotent).
- Calling with an email not in `ADMIN_EMAILS` returns `false` and inserts
  nothing.
- With `ADMIN_EMAILS` unset, calling with any email returns `false`.
- Case-insensitivity: `ADMIN_EMAILS=User@Example.com` matches `user@example.com`.
- Multiple emails: `ADMIN_EMAILS=a@x.com, b@x.com` — both match; `c@x.com`
  does not.

**Existing tests to run:** `npm run test:server` — verify no regressions in
the auth route test suite.

### Documentation Updates

Add a commented example to both public env files:

```
# Admin bootstrap — comma-separated list of emails that gain admin on first login
# ADMIN_EMAILS=instructor@jointheleague.org
```
