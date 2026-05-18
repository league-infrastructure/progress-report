---
id: '003'
title: Admin Users frontend page
status: done
use-cases:
- SUC-002
depends-on:
- '002'
github-issue: ''
todo: admin-access-and-management.md
completes_todo: true
---

# Admin Users frontend page

## Description

Admins currently have no UI to see who else has admin access or to add/remove
admins. This ticket adds a new page at `/admin/users` with a list of current
admins, a form to add a new admin by email, and a per-row remove button with
confirmation. A "Admin Users" link is added to the admin sidebar.

Depends on ticket 002 (the API endpoints must exist before the page is useful).

## Acceptance Criteria

- [ ] `/admin/users` route is registered in the client-side router and renders
      `AdminUsersPage`.
- [ ] Page lists all current admin emails fetched from `GET /api/admin/users`.
- [ ] Each row has a "Remove" button that is disabled (or absent) for the
      current user's own email.
- [ ] Clicking "Remove" shows a confirmation (native `window.confirm` or a
      simple inline confirm state) before firing `DELETE`.
- [ ] After a successful remove, the list refreshes.
- [ ] The "Add Admin" form accepts an email address and submits via `POST
      /api/admin/users` on form submit.
- [ ] After a successful add, the list refreshes and the input clears.
- [ ] A 409 from the API (already an admin) is shown as an inline error message.
- [ ] A sidebar link "Admin Users" with a `UserCog` icon appears in
      `AdminLayout` under the Admin section, pointing to `/admin/users`.
- [ ] Loading and error states are handled (spinner while fetching, error
      message on failure).

## Implementation Plan

### Approach

New page component using React Query (already used in `AdminDashboardPage`).
Minimal new state — React Query handles refetch after mutations. No new shared
components required; follow the existing card/table patterns from
`AdminDashboardPage`.

### Files to Create

- `client/src/pages/AdminUsersPage.tsx`

### Files to Modify

- `client/src/components/AdminLayout.tsx` — add "Admin Users" nav link
- `client/src/App.tsx` (or wherever the admin routes are registered) — add
  `/admin/users` route

### Finding the Router Registration

Before implementing, read the client router file to locate where admin routes
are registered. Search for the `AdminDashboardPage` import to find the right
file.

### Implementation Detail

**`client/src/pages/AdminUsersPage.tsx`** outline:

```typescript
// Types
interface AdminUser { email: string; createdAt: string }

// API helpers
async function fetchAdminUsers(): Promise<AdminUser[]> { ... }
async function addAdmin(email: string): Promise<AdminUser> { ... }
async function removeAdmin(email: string): Promise<void> { ... }

// Page component
export function AdminUsersPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [newEmail, setNewEmail] = useState('')
  const [addError, setAddError] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users'],
    queryFn: fetchAdminUsers,
  })

  const addMutation = useMutation({
    mutationFn: addAdmin,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); setNewEmail(''); setAddError('') },
    onError: (e) => setAddError(e.message),
  })

  const removeMutation = useMutation({
    mutationFn: removeAdmin,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  function handleRemove(email: string) {
    if (!window.confirm(`Remove admin access for ${email}?`)) return
    removeMutation.mutate(email)
  }

  // render: loading spinner, error banner, table of users, add form
}
```

Follow the existing card/table markup patterns from `AdminDashboardPage` and
`AdminFeedbackPage` for consistent visual style. Do not introduce new CSS
classes; reuse existing ones.

**`client/src/components/AdminLayout.tsx`:**

Add to the `ADMIN_LINKS` array:

```typescript
import { BarChart, Users, Shield, MessageSquare, Heart, Bell, Home, UserCog } from 'lucide-react'

const ADMIN_LINKS = [
  { href: '/admin',                  label: 'Overview',     Icon: BarChart },
  { href: '/admin/instructors',      label: 'Instructors',  Icon: Users },
  { href: '/admin/compliance',       label: 'Compliance',   Icon: Shield },
  { href: '/admin/volunteer-hours',  label: 'Volunteers',   Icon: Heart },
  { href: '/admin/feedback',         label: 'Feedback',     Icon: MessageSquare },
  { href: '/admin/users',            label: 'Admin Users',  Icon: UserCog },
]
```

### Testing Plan

**New tests** (`tests/client/AdminUsersPage.test.tsx`):

Use Vitest + React Testing Library. Mock `fetch` with `vi.fn()`.

- Renders a loading state while the query is in flight.
- Renders a list of admin emails after a successful fetch.
- Does not show "Remove" button for the current user's own email.
- Clicking Remove on another user calls the API and triggers a list refetch.
- Submitting the add form calls `POST /api/admin/users` and clears the input.
- A 409 response from the add API shows an inline error message.

**Existing tests to run:** `npm run test:client`

### Documentation Updates

None required beyond the sidebar link change, which is visible in the UI.
