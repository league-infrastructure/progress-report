---
id: '002'
title: Admin Access and Claude Haiku Integration
status: done
branch: sprint/002-admin-access-and-claude-haiku-integration
use-cases:
- SUC-001
- SUC-002
- SUC-003
todos:
- admin-access-and-management.md
- switch-ai-provider-groq-to-claude.md
---

# Sprint 002: Admin Access and Claude Haiku Integration

## Goals

1. Allow the stakeholder (an instructor) to bootstrap admin access without
   any manual database intervention, by reading a comma-separated
   `ADMIN_EMAILS` environment variable at login time.
2. Provide an Admin Users management page so admins can grant and revoke
   admin access for other users.
3. Replace all Groq API usage in the report generator and Slack reminder
   service with the Anthropic Claude Haiku API (`claude-haiku-4-5-20251001`).

## Problem

Two independent blockers prevent the stakeholder from using the app as an admin
and from generating AI-powered reviews:

- **Admin bootstrap gap**: The `adminSettings` table is empty on a fresh
  deployment. There is no mechanism to insert the first admin without direct
  database access. Once an admin exists, there is no UI to manage other admins.
- **Wrong AI provider**: Report generation (`POST /api/reviews/:id/generate-github-draft`)
  and the Slack reminder service are wired to the Groq API with `llama-3.3-70b-versatile`.
  The stakeholder has an Anthropic API key, not a Groq key. The `ANTHROPIC_API_KEY`
  secret already exists in the template but is unused.

## Solution

**Admin bootstrap**: At Pike13 OAuth login time, after the standard `adminSettings`
table lookup, also check whether the authenticated user's email appears in the
`ADMIN_EMAILS` environment variable (comma-separated, case-insensitive). If so,
upsert a row into `adminSettings` for that email before setting `isAdmin` on the
session. This is a one-time write — subsequent logins will find the row and skip
the upsert.

**Admin Users page**: Add `GET /api/admin/users`, `POST /api/admin/users`, and
`DELETE /api/admin/users/:email` API routes protected by the existing `isAdmin`
middleware. Add a frontend page at `/admin/users` that lists current admins with
remove buttons and a form to add new admins. Add a sidebar link in `AdminLayout`.

**AI provider swap**: Remove `groq-sdk` and install `@anthropic-ai/sdk`. Update
`reviews.ts` and `slackReminder.ts` to use the Anthropic client. The prompt
content is unchanged; only the client call and env var guard change. Remove
`GROQ_API_KEY` from all config files and documentation.

## Success Criteria

- User in `ADMIN_EMAILS` becomes an admin on next login with no manual DB work
- Admin Users page lists all admin emails; admins can be added and removed
- Removing yourself as admin is blocked (prevents lockout)
- Report generation calls Anthropic API with `claude-haiku-4-5-20251001`
- Slack reminder generation calls same model
- `groq-sdk` is absent from `package.json`
- `GROQ_API_KEY` does not appear anywhere in application code

## Scope

### In Scope

- `ADMIN_EMAILS` env var bootstrap in `server/src/routes/auth.ts`
- `GET/POST/DELETE /api/admin/users` routes in `server/src/routes/admin.ts`
- Frontend `AdminUsersPage` at `/admin/users`
- Sidebar link "Admin Users" in `AdminLayout`
- Replace Groq with Anthropic SDK in `reviews.ts` and `slackReminder.ts`
- Remove `groq-sdk` from `server/package.json`
- Update `GROQ_API_KEY` → `ANTHROPIC_API_KEY` guard in both files
- Update secrets documentation

### Out of Scope

- Any changes to the session type or other session fields
- Role granularity beyond the existing boolean `isAdmin` flag
- Admin audit logging
- Any changes to the review prompt content or output format
- Migration of model — Claude Haiku is a drop-in replacement; the prompts are
  unchanged

## Test Strategy

- **Backend (Jest + Supertest)**: Unit-test the `ADMIN_EMAILS` bootstrap logic
  with a mock DB; test the three admin-users API routes for happy path and
  guard cases (self-removal blocked, duplicate email handled).
- **Frontend (Vitest + RTL)**: Render `AdminUsersPage` against a mock API;
  verify list render, add flow, and remove-with-confirmation flow.
- **Manual smoke test**: Start the dev server with `ADMIN_EMAILS` set; log in
  via Pike13 and confirm admin access. Test report generation end-to-end with
  the Anthropic API key.

## Architecture Notes

- No schema migration is required for the admin bootstrap change — `adminSettings`
  already has the correct structure (`email`, `createdAt`).
- The Anthropic SDK chat completions API mirrors the OpenAI format closely.
  `client.messages.create()` replaces `client.chat.completions.create()`.
  The `choices[0].message.content` access pattern changes to
  `response.content[0].text`.
- `ADMIN_EMAILS` is a non-secret env var (it controls access policy but is not
  a credential). It should live in `config/prod/public.env` and
  `config/dev/public.env`, not in secrets.

## GitHub Issues

(None linked.)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On |
|---|-------|------------|
| 001 | Admin bootstrap via ADMIN_EMAILS env var | — |
| 002 | Admin Users API endpoints | 001 |
| 003 | Admin Users frontend page | 002 |
| 004 | Replace Groq with Anthropic Claude Haiku | — |

Tickets 001 and 004 can execute in parallel (no shared dependencies).
Ticket 002 requires 001. Ticket 003 requires 002.
