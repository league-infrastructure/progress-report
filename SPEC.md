# LEAGUE Report — Technical Specification

## Overview

LEAGUE Report is a full-stack web app for managing monthly instructor-to-guardian student progress reviews at The LEAGUE of Amazing Programmers.

**Roles:**
- **Instructors** — write and send monthly progress reviews for their assigned students
- **Admins** — oversee all instructors, compliance, volunteer hours, and scheduling
- **Guardians** — submit star-rating feedback via unauthenticated public links

---

## Architecture

```
client/       Vite + React 19 SPA (TypeScript)
server/       Express 4 API server (TypeScript, Node.js 20 LTS)
  src/
    db/       Drizzle schema + SQLite connection
    routes/   Express route handlers
    services/ Business logic (Pike13 sync, review generation, Slack, email)
```

No shared layer — API types are declared in `client/src/types/` and kept in sync with the server response shapes manually.

---

## Frontend

- React 19, Wouter (client-side routing), TanStack React Query (server state)
- Lucide React icons
- Custom CSS (no Tailwind or CSS framework)
- `react-hook-form` + Zod for forms

**Instructor pages:**
| Route | Page |
|-------|------|
| `/dashboard` | Dashboard with student roster and monthly stats |
| `/reviews` | Review list for the selected month |
| `/reviews/:id` | Review editor with AI draft generation |
| `/templates` | Template list |
| `/templates/:id` | Template editor |
| `/checkin` | Weekly TA check-in form |

**Admin pages:**
| Route | Page |
|-------|------|
| `/admin` | Admin dashboard (notifications, sync, analytics) |
| `/admin/instructors` | Instructor list with student counts and ratio badges |
| `/admin/reviews` | All student reviews for the month, filterable by instructor |
| `/admin/reviews/:id` | Admin review editor |
| `/admin/compliance` | Month compliance grid per instructor |
| `/admin/volunteer-hours` | Volunteer hours log |
| `/admin/schedule` | Weekly volunteer/instructor event schedule |

**Public pages:**
| Route | Page |
|-------|------|
| `/login` | Pike13 OAuth login |
| `/feedback/:token` | Guardian feedback form (no auth) |
| `/pending` | Shown to users whose instructor account is not yet active |

---

## Backend

Express 4 with TypeScript, compiled by `tsc`. All routes prefixed with `/api`.

**Route files:**

| File | Prefix | Auth |
|------|--------|------|
| `auth.ts` | `/api/auth` | Public |
| `health.ts` | `/api/health` | Public |
| `feedback.ts` | `/api/feedback` | Public |
| `reviews.ts` | `/api/reviews` | Active instructor |
| `instructor.ts` | `/api/instructor` | Active instructor |
| `templates.ts` | `/api/templates` | Active instructor |
| `checkins.ts` | `/api/checkins` | Active instructor |
| `volunteer-hours.ts` | `/api/volunteer-hours` | Active instructor |
| `admin.ts` | `/api/admin` | Admin |
| `slack.ts` | `/api/slack` | Slack signature verification |

**Middleware:**
- `isAuthenticated` — requires `req.session.user`
- `isActiveInstructor` — requires `req.session.user.isActiveInstructor`
- `isAdmin` — requires `req.session.user.isAdmin`
- `errorHandler` — catches unhandled errors, logs with pino, returns `{ error, detail }`

**Logging:** pino + pino-http (structured JSON)

---

## Database

SQLite via Drizzle ORM (`drizzle-orm/better-sqlite3`). Single file at `$DATABASE_URL`.

WAL mode is enabled for better concurrent reads. Migrations run at startup via `drizzle-kit migrate`.

**Tables:**

| Table | Purpose |
|-------|---------|
| `users` | All authenticated users (email + name from Pike13) |
| `sessions` | Express session store (better-sqlite3-session-store) |
| `instructors` | Instructor records linked to users; `isActive` flag |
| `students` | All Pike13 clients; `pike13SyncId` is the dedup key |
| `instructor_students` | Instructor → student assignments (composite PK); `lastSeenAt` tracks recency |
| `student_attendance` | Per-session attendance records; unique on `(studentId, instructorId, eventOccurrenceId)` |
| `monthly_reviews` | One review per `(instructorId, studentId, month)`; status: `pending` → `draft` → `sent` |
| `review_templates` | Per-instructor reusable review templates with placeholder support |
| `service_feedback` | Guardian star-rating feedback linked to a review via `feedbackToken` |
| `admin_settings` | Email whitelist for admin access |
| `pike13_tokens` | Per-instructor Pike13 OAuth tokens (one per instructor) |
| `pike13_admin_token` | Single admin-level Pike13 token for server-side sync |
| `ta_checkins` | Weekly TA presence check-ins submitted by instructors |
| `admin_notifications` | In-app admin notification feed |
| `volunteer_hours` | Volunteer service hours (manual or Pike13-synced) |
| `volunteer_schedule` | Per-volunteer scheduled status for the current week |
| `volunteer_event_schedule` | Current-week event schedule with instructor and volunteer lists |

**Key schema notes:**
- Timestamps stored as `integer({ mode: 'timestamp' })` (Unix seconds via Drizzle)
- UUIDs via `$defaultFn(() => crypto.randomUUID())`
- JSON columns via `text({ mode: 'json' })`
- `instructors.userId` has no unique constraint — be aware that duplicate rows can exist if a race condition occurs between auth and sync; auth and sync both consistently use the lowest-ID row per user

---

## Authentication

**Flow:**
1. User clicks "Log in with Pike13" → redirected to Pike13 OAuth
2. Pike13 redirects back with code → server exchanges for access token
3. Server fetches user profile from `/api/v2/front/people/me`
4. Only `@jointheleague.org` emails are admitted; others get `?error=denied`
5. User record found or created in `users` by email
6. Instructor record found or created in `instructors` by `userId`
7. Admin status checked against `admin_settings.email`
8. Pike13 token saved/updated in `pike13_tokens`
9. Background Pike13 sync triggered with user's token
10. Session written; user redirected to `/admin` (admins) or `/dashboard` (instructors)

**Session shape:**
```ts
interface SessionUser {
  id: number;           // users.id
  name: string;
  email: string;
  isAdmin: boolean;
  isActiveInstructor: boolean;
  instructorId?: number; // instructors.id
}
```

---

## Pike13 Integration

The sync service (`server/src/services/pike13Sync.ts`) runs on login (background) and on-demand via admin or instructor dashboard buttons.

**Sync steps:**
1. Fetch all staff from `desk/staff_members` — non-TA/VA staff with emails are instructors
2. Upsert `users` + `instructors` records for each instructor staff member
3. Build `emailToInstructorId` map (lowest-ID instructor wins per email)
4. Build `pike13StaffIdToInstructorId` map via email lookup
5. Fetch YTD event occurrences in weekly chunks (Jan 1 → now)
6. Fetch upcoming events (now → +4 weeks) for volunteer scheduled-status
7. Upsert `volunteer_event_schedule` from current-week events
8. Compute and upsert volunteer hours from YTD events
9. Paginate `desk/people` → upsert all clients as `students`
10. For each YTD event occurrence:
    - **Skip make-up classes** (name matches `make[\s-]?up`, case-insensitive)
    - For each instructor on the event, for each attendee with `visit_state === 'completed'`:
      - Upsert `instructor_students`
      - Insert `student_attendance` (deduped on `(studentId, instructorId, eventOccurrenceId)`)

**TA/VA filtering:** Staff whose Pike13 name starts with `TA` or `VA` (followed by space or dash) are treated as volunteers, not instructors, in event processing.

---

## Review Lifecycle

```
[no review] → pending → draft → sent
```

- **Pending** — a `monthly_reviews` row exists but has no body
- **Draft** — body has been written or generated
- **Sent** — dispatched to guardian; body is locked

**Delivery channels (in priority order):**
1. Pike13 note — if the instructor has a connected Pike13 token and the student has a `pike13SyncId`
2. SendGrid email — fallback if Pike13 is not connected but `students.guardianEmail` exists

**AI draft generation:**
- Uses `claude-haiku-4-5-20251001`
- Pulls GitHub push events for the student's username (paginated, past 30 days)
- Filters to League curriculum repos (by name pattern or fork parent org)
- Enriches commits with file-level stats
- Two modes: full free-form, or template-guided (fills `{{progress}}`, `{{highlights}}`, `{{instructorNotes}}` placeholders)

**Template placeholders:**

| Placeholder | Source | Filled by |
|-------------|--------|-----------|
| `{{studentName}}` | `students.name` | Server |
| `{{guardianName}}` | `students.guardianName` | Server |
| `{{month}}` | Review month | Server |
| `{{instructorName}}` | `users.name` | Server |
| `{{instructorEmail}}` | `users.email` | Server |
| `{{attendanceSummary}}` | `student_attendance` | Server |
| `{{githubSummary}}` | GitHub API | Server |
| `{{progress}}` | GitHub commits | Claude AI |
| `{{highlights}}` | GitHub commits | Claude AI |
| `{{instructorNotes}}` | GitHub commits | Claude AI |

---

## Slack Integration

**Bot token scopes required:** `chat:write`, `users:lookup-by-email`, `im:write`

**Features:**
- **Monthly reminders** — sent via DM on the 1st of each month (configurable via `SLACK_REMIND_DAY`). Only sends to instructors who are the primary instructor for students with no sent review. Primary instructor = highest monthly session count; all-time count as tiebreaker.
- **Compliance report** — admin-triggered post to `SLACK_REVIEWS_CHANNEL` with per-instructor sent/draft/pending counts
- **Slack bot** — natural language DM interface powered by Claude. Instructors can ask for their pending students, generate a review for a specific student, and post drafts with Send/Discard buttons.

**Incoming events handled:** `app_mention`, `message.im` (direct messages to the bot)

---

## Scheduling

`node-cron` runs inside the server process. One job: monthly Slack reminders at 09:00 UTC on day `SLACK_REMIND_DAY` (default `1`).

---

## Deployment

Docker Swarm on a single node (`swarm2`). Caddy reverse proxy handles TLS.

Image: `ghcr.io/league-infrastructure/progress-report:<version>`

SQLite data persisted on a named Docker volume (`app-data:/app/data`).

Migrations run at container startup before the server starts.

See [docs/deployment.md](docs/deployment.md) and [docs/docker-image-build.md](docs/docker-image-build.md).
