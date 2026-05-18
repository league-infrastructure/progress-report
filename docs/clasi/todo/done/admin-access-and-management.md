---
title: Admin Access Bootstrap and User Management UI
status: done
sprint: '002'
tickets:
- '001'
- '002'
- '003'
---

## Problem

The logged-in user (an instructor) cannot access the admin page because their
email is not in the `adminSettings` table. There is no existing mechanism to
bootstrap the first admin — admins must be manually inserted into the database.
Additionally, there is no UI for existing admins to grant or revoke admin
access for other users.

## Tasks

1. **Bootstrap initial admin via env var**: Read a comma-separated
   `ADMIN_EMAILS` environment variable at login time. Any authenticated user
   whose email appears in `ADMIN_EMAILS` is automatically added to the
   `adminSettings` table and granted `isAdmin = true` in their session.

2. **Admin Users management page**: Add a new page at `/admin/users` in the
   admin UI that lists all current admin emails and allows an admin to:
   - Add a new admin by entering an email address
   - Remove admin access from an existing admin (with confirmation)

3. **API endpoints**: Add `GET /api/admin/users` and `POST /api/admin/users`
   and `DELETE /api/admin/users/:email` endpoints protected by the `isAdmin`
   middleware.

## Acceptance Criteria

- [ ] User whose email is in `ADMIN_EMAILS` env var gains admin access on next
      login without any manual DB intervention
- [ ] Admin sidebar shows an "Admin Users" link under the admin section
- [ ] Admin Users page lists all current admins with a remove button per row
- [ ] Admin can add a new admin email via a form on the page
- [ ] Removing an admin requires confirmation before taking effect
- [ ] An admin cannot remove themselves (prevents lockout)
