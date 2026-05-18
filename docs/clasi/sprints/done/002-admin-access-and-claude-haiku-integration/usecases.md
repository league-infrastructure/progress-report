---
sprint: '002'
status: done
---

# Use Cases — Sprint 002: Admin Access and Claude Haiku Integration

## SUC-001: Bootstrap Admin Access via Environment Variable

**Actor:** Instructor (stakeholder)

**Preconditions:**
- `ADMIN_EMAILS` env var contains the instructor's email (comma-separated,
  case-insensitive).
- The `adminSettings` table may be empty (fresh deployment).

**Main Flow:**
1. Instructor completes Pike13 OAuth flow.
2. Server resolves the authenticated email (already normalized to lowercase).
3. Server parses `ADMIN_EMAILS` and checks whether the email is present.
4. If found, server upserts a row into `adminSettings` for that email.
5. Server sets `isAdmin: true` on the session (existing logic reads the row
   it just upserted).
6. Instructor is redirected to `/admin`.

**Postconditions:** The instructor has admin access. On subsequent logins the
standard `adminSettings` table lookup finds the existing row and no upsert
occurs.

**Acceptance Criteria:**
- [ ] User in `ADMIN_EMAILS` gains `isAdmin: true` on login without any manual
      DB intervention.
- [ ] If `ADMIN_EMAILS` is not set or does not contain the user's email, no row
      is inserted and behaviour is unchanged.
- [ ] Multiple emails in `ADMIN_EMAILS` are all processed correctly.
- [ ] Match is case-insensitive.

---

## SUC-002: Manage Admin Users

**Actor:** Admin (any user with `isAdmin: true` in session)

**Preconditions:** Actor is authenticated with `isAdmin: true`.

**Main Flow — List admins:**
1. Admin navigates to `/admin/users`.
2. Frontend fetches `GET /api/admin/users`.
3. Page displays a table of current admin emails with a "Remove" button per row.

**Main Flow — Add admin:**
1. Admin enters an email address and submits the "Add Admin" form.
2. Frontend posts `POST /api/admin/users` with `{ email }`.
3. Server upserts a row into `adminSettings`.
4. Page refreshes the admin list.

**Main Flow — Remove admin:**
1. Admin clicks "Remove" next to a row that is not their own email.
2. A confirmation prompt appears.
3. On confirm, frontend sends `DELETE /api/admin/users/:email`.
4. Server deletes the `adminSettings` row for that email.
5. Page refreshes the admin list.

**Postconditions:** `adminSettings` reflects changes. Removed users retain
their active session's `isAdmin: true` until next login.

**Acceptance Criteria:**
- [ ] `GET /api/admin/users` returns all rows from `adminSettings`.
- [ ] `POST /api/admin/users` inserts a new admin; returns 409 if already present.
- [ ] `DELETE /api/admin/users/:email` removes the row; returns 404 if not found.
- [ ] An admin cannot delete their own email via the API (server returns 409).
- [ ] Admin sidebar shows an "Admin Users" link.
- [ ] All three routes require `isAdmin` middleware; unauthenticated requests get 401.

---

## SUC-003: Generate AI Review Draft with Claude Haiku

**Actor:** Instructor

**Preconditions:**
- `ANTHROPIC_API_KEY` is set in the server environment.
- Student has a linked GitHub username.
- Student has push activity in the past 30 days.

**Main Flow:**
1. Instructor opens a monthly review and clicks "Generate Draft".
2. Server fetches GitHub events and enriches commit data (unchanged logic).
3. Server calls Anthropic `messages.create` with model `claude-haiku-4-5-20251001`
   using the existing prompt content.
4. Server assembles the response body and returns it to the frontend.
5. Instructor reviews, edits, and saves the draft.

**Postconditions:** Review draft field is populated with AI-generated content.

**Acceptance Criteria:**
- [ ] `GROQ_API_KEY` is not referenced anywhere in the codebase.
- [ ] `groq-sdk` is removed from `server/package.json`.
- [ ] Report generation calls Anthropic API with `claude-haiku-4-5-20251001`.
- [ ] If `ANTHROPIC_API_KEY` is absent, the endpoint returns a 500 with a
      clear error message.
- [ ] Slack reminder service also uses Anthropic when `ANTHROPIC_API_KEY` is set.
- [ ] `ANTHROPIC_API_KEY` is documented in all secrets example files as required.
