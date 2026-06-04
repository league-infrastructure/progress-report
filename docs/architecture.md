# Architecture

## High-Level Overview

```
Browser
  └─ Vite + React SPA (port 5173 in dev / served by Express in prod)
       └─ TanStack React Query → fetch() → /api/*
            └─ Express (port 3000)
                 ├─ SQLite (Drizzle ORM, better-sqlite3)
                 ├─ Pike13 API (OAuth + REST)
                 ├─ Claude API (review drafts, Slack bot NLP)
                 ├─ GitHub API (student commit history)
                 ├─ Slack API (DMs, bot, channels)
                 └─ SendGrid API (fallback email delivery)
```

In production, Caddy terminates TLS and reverse-proxies to the Express container on the Swarm node.

---

## Request Flow

### Authentication

Every protected request goes through one of three middleware guards:

- `isAuthenticated` — requires a valid session cookie
- `isActiveInstructor` — requires `session.user.isActiveInstructor === true`
- `isAdmin` — requires `session.user.isAdmin === true`

The session is stored in the `sessions` SQLite table via `better-sqlite3-session-store`. Sessions expire after 24 hours (configurable).

### Instructor login sequence

```
User → GET /api/auth/pike13
  → Redirect to pike13.com/oauth/authorize
  → Pike13 redirects to /api/auth/pike13/callback?code=...
  → Server exchanges code for access token
  → Server fetches /api/v2/front/people/me (name + email)
  → Email must end with @jointheleague.org
  → Upsert user + instructor records
  → Save Pike13 token in pike13_tokens
  → Trigger background Pike13 sync with this token
  → Write session → redirect to /dashboard (or /admin)
```

---

## Data Model

### Student assignment

Students are assigned to instructors via the `instructor_students` table. The sync creates this from Pike13 event occurrences: any student who completed a visit on an event where an instructor was listed as staff gets assigned to that instructor.

Make-up class events (name matches `make[\s-]?up`) are excluded — students attending a make-up class do not get assigned to the substitute instructor.

The `student_attendance` table records individual sessions: one row per `(studentId, instructorId, eventOccurrenceId)`. This is the source for the attendance dates shown in review drafts and for determining the "primary instructor" for monthly reminders.

### Review lifecycle

```
instructor_students row exists
  → "Start a Review" button creates a monthly_reviews row (status: pending)
  → Instructor writes or AI-generates a body (status: draft)
  → Instructor clicks Send (status: sent)
      → Pike13 note OR SendGrid email dispatched asynchronously
      → feedbackToken included → guardian can open /feedback/:token
```

### Primary instructor logic (Slack reminders)

When a student attends multiple instructors' classes, only one instructor should be reminded to write their review. The primary instructor is determined by:

1. **Monthly session count** (highest wins)
2. **All-time session count** (tiebreaker)
3. **`instructorStudents.instructorId`** (final fallback if no attendance data)

---

## Key Services

### `pike13Sync.ts`

The central sync service. Called on instructor login (background, non-blocking) and on-demand via admin/instructor dashboard buttons.

Fetches:
- `desk/staff_members` — all Pike13 staff
- `desk/event_occurrences` — YTD in weekly chunks; upcoming 4 weeks for schedule
- `desk/people` — all clients (paginated)

Writes:
- `users`, `instructors` — one record per Pike13 staff member (lowest-ID wins if duplicates exist)
- `students` — one record per Pike13 person, keyed on `pike13SyncId`
- `instructor_students` — assignment per event (make-up classes excluded)
- `student_attendance` — per-session record
- `volunteer_hours` — hours from YTD events for non-instructor staff
- `volunteer_event_schedule` — current-week events for the schedule view
- `volunteer_schedule` — scheduled status per volunteer

### `reviewGenerator.ts`

Generates review draft bodies using the Claude API. Two modes:

- **Free-form** — Claude writes three flowing paragraphs based on GitHub activity and attendance
- **Template-guided** — fills `{{progress}}`, `{{highlights}}`, `{{instructorNotes}}` placeholders using a structured JSON response from Claude; all other template placeholders (`{{studentName}}`, etc.) are filled by the server

GitHub activity is fetched via the Events API (up to 10 pages), filtered to League curriculum repos, and enriched with per-commit file stats.

### `slackBot.ts`

Handles incoming Slack events (app mentions and DMs). Uses Claude to parse natural language intent, then:
- Lists pending students for an instructor
- Generates a review draft for a named student or GitHub username
- Posts a draft with interactive Send/Discard buttons

### `slackReminder.ts`

Sends monthly Slack DMs to instructors with pending reviews. Filters to one instructor per student (primary instructor) to avoid sending duplicate reminders.

Uses Claude Haiku to write a friendly, personalized reminder message when `ANTHROPIC_API_KEY` is set; falls back to a static message otherwise.

### `email.ts`

SendGrid-based email delivery. Used as a fallback when an instructor has not connected Pike13 or the student has no `pike13SyncId`.

---

## Frontend Architecture

### State management

All server state is managed by TanStack React Query. Each page component owns its queries. There is no global state store (no Redux, no Zustand).

### Routing

Wouter handles client-side routing. The Express server is configured to serve the React `index.html` for any non-API route, enabling full client-side navigation.

### API calls

Raw `fetch()` calls in async functions co-located with the components that use them. Response types are declared in `client/src/types/` and manually kept in sync with server responses.

---

## Deployment Architecture

```
GitHub Actions (or manual)
  → scripts/build_image.sh
      → docker buildx (linux/amd64 + linux/arm64)
      → push to ghcr.io/league-infrastructure/progress-report:<version>

scripts/deploy_stack.sh
  → docker stack deploy --with-registry-auth
      → Docker Swarm service updated on swarm2
          → SQLite on named volume app-data
          → Caddy routes progress.jtlapp.net → container port 3000
```

Migrations run automatically at container startup before `node dist/index.js`.

See [docs/docker-image-build.md](docker-image-build.md) for the full build and versioning workflow.

---

## Security Notes

- Only `@jointheleague.org` Pike13 accounts can log in
- Admin access is granted by adding an email to the `admin_settings` table — no self-service promotion
- Feedback tokens are random UUIDs — the feedback page is public but unforgeable
- Pike13 tokens are stored in the database but never exposed to the client
- All API routes except `/api/health`, `/api/auth/*`, and `/api/feedback/*` require a valid session
- The Slack events endpoint verifies the `X-Slack-Signature` header before processing
