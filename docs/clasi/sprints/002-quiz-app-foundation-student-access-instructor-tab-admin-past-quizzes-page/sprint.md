---
id: "002"
title: "Quiz App: foundation, student access, instructor tab & admin past-quizzes page"
status: planning
branch: sprint/002-quiz-app-foundation-student-access-instructor-tab-admin-past-quizzes-page
use-cases:
  - SUC-001
  - SUC-002
  - SUC-003
  - SUC-004
  - SUC-005
  - SUC-006
  - SUC-007
  - SUC-008
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 002: Quiz App — Foundation, Student Access, Instructor Tab & Admin Past-Quizzes Page

## Goals

Deliver a working vertical slice of the League Quiz App integrated into the
existing `progress-report` codebase. By the end of this sprint:

- The quiz DB schema is live with compiled quiz banks seeded from
  `Quiz-App/quizzes/`.
- Students can authenticate via GitHub OAuth and take assigned quizzes.
- Students can take quizzes through tokenized assignment links with no account.
- Instructors can look up a student, assign a quiz, and review results on their
  instructor tab.
- Admins can inspect all past quiz attempts on a filterable detail page.
- Deterministic auto-grading (multiple-choice exact match; short-answer
  normalized match) is implemented and tested.
- Role guards (student / instructor / admin) are enforced server-side; student
  queries are scoped to the student's own ID.

## Integrate vs. Standalone Recommendation

**Recommendation: Option A — Integrate into the existing `progress-report` app.**

The quiz subsystem shares every infrastructure component already present in
`progress-report`: Express + TypeScript backend, SQLite via Drizzle ORM,
Vite + React frontend, Pike13 OAuth (staff auth), SendGrid (email), Docker
Swarm + Caddy + SOPS/age + rundbat. The existing `server/src/db/schema.ts`,
session middleware, Pike13 auth route, role guards (`isAdmin`,
`isActiveInstructor`), and `SessionUser` type are all directly reusable.

Introducing a standalone `Quiz-App/server/` and `Quiz-App/client/` would
duplicate: the Express app entry point, the Drizzle connection and session
store, the Pike13 OAuth callback, the session type declarations, the Docker
Compose and rundbat configuration, and the deployment pipeline. Operationally,
two apps means two Docker services, two Caddy upstreams, two secret trees, and
two deploy cycles for what is conceptually one League staff + student tool.

**Integration plan:**
- Add quiz tables to `server/src/db/schema.ts` and generate a new migration.
- Add quiz routes under `server/src/routes/quiz/` (student, instructor, admin
  sub-routers).
- Add quiz services under `server/src/services/quiz/` (grader, sampler,
  tokenizer).
- Add quiz pages under `client/src/pages/quiz/` and wire into `App.tsx`.
- Extend `SessionUser` to carry `githubLogin` and `quizRole`
  (`student | instructor | admin`).
- The compiled banks in `Quiz-App/quizzes/` are loaded by a seed script at
  startup; no quiz content authoring happens at runtime.

**What stays in `Quiz-App/`:** The spec (`SPEC.md`), concept source files,
compiled quiz banks (`quizzes/`), and build script (`scripts/build_quizzes.py`)
remain as reference/data — they are not a running application.

## Problem

The League has no structured way to test student knowledge against their
curriculum progress. Instructors manually track who has completed what; there
is no automated quiz assignment, grading, or result visibility. Students
(minors) need a low-friction path to take quizzes (tokenized links) without
requiring account creation.

## Solution

Extend the existing LEAGUE Report app with a quiz subsystem behind role-based
access control. New tables are added to the shared SQLite database. GitHub OAuth
is added as a second login path for students. A quiz sampler draws 10 questions
per lesson favoring unseen questions. A grader evaluates answers deterministically.
A token service mints expiring single-use assignment links. The frontend gains
student, instructor, and admin quiz surfaces.

## Success Criteria

- `GET /api/quiz/levels` returns the 2 levels and 43 lessons from seeded DB.
- A student can log in via GitHub OAuth and see their assigned quizzes.
- A student can open a tokenized link and submit a quiz without logging in.
- An instructor can look up a student by GitHub username and assign a quiz.
- An instructor's tab shows their students with assigned quizzes and results.
- Submitting a quiz auto-grades it; score = correct/10 × 100; pass ≥ 70%.
- Student queries never return another student's data (isolation enforced).
- An admin can view the past-quizzes page filtered by date, student, or lesson.
- All tests pass: `npm run test:db`, `npm run test:server`, `npm run test:client`.

## Scope

### In Scope

1. **Quiz DB schema** — new Drizzle tables: `quizUsers`, `quizLevels`,
   `quizLessons`, `quizQuestions`, `quizzes`, `quizAttempts`,
   `quizSeenQuestions`, `quizAssignmentTokens`. Migration generated and applied.
2. **Quiz bank seeder** — startup/seed script that reads `Quiz-App/quizzes/`
   JSON and populates `quizLevels`, `quizLessons`, `quizQuestions` (idempotent,
   keyed on stable question ID from the bank).
3. **GitHub OAuth** — new Passport.js `GitHubStrategy`; creates/updates a
   `quizUsers` row with role `student`; session carries `githubLogin`.
4. **Staff auth extension** — existing Pike13 OAuth populates `quizUsers` with
   role from `INSTRUCTOR_ALLOWLIST` / `ADMIN_ALLOWLIST`; session extended.
5. **Role-guard middleware** — `requireQuizRole(...roles)` middleware; student
   queries scoped server-side to `req.quizUser.id`.
6. **Token service** — `mintAssignmentToken(quizId)` creates a UUID token +
   expiry in `quizAssignmentTokens`; `resolveToken(token)` validates and returns
   the quiz; token consumed on first submission.
7. **Quiz sampler** — `sampleQuestions(lessonId, studentId, n=10)`: spread
   across concepts, favor unseen (no `SeenQuestion` row), top up with
   least-recently-seen.
8. **Grader** — `gradeAttempt(quiz, answers)`: MC exact match; short-answer
   normalized (lowercase, trim, collapse whitespace, normalize quotes).
9. **Instructor API** — look up student by GitHub username; assign a quiz
   (returns tokenized link); list own students with their quizzes + scores.
10. **Student API** — list assigned quizzes; fetch quiz questions; submit attempt.
11. **Admin API** — list all attempts with full detail; filter by date range,
    student, lesson; pass/fail breakdown.
12. **Frontend — student** — GitHub login page; student dashboard (assigned
    quizzes, statuses); quiz-taking view (questions form); result view
    (score + per-question explanations); tokenized-link entry point.
13. **Frontend — instructor tab** — student lookup form; assign quiz modal; tab
    listing students with quiz/score summary.
14. **Frontend — admin past-quizzes page** — filterable table of all attempts
    with full detail.
15. **Tests** — db layer (schema + seed), server layer (routes + grader +
    sampler), client layer (key components), e2e (assign → take → grade flow).

### Out of Scope (future sprints)

- Repo-completion gating (`RepoInspector`, 90% eligibility rule, readiness
  report) — Sprint 003.
- Pike13 parent/instructor notification on completion — Sprint 003.
- Badges and level advancement — Sprint 003.
- Public placement-assessment flow + result email — Sprint 004.
- Java levels — deferred; Python only for v1.
- AI-assisted short-answer grading — deferred.
- Instructor manual score adjustment — deferred.
- `--format league` quiz round-trip exporter — deferred.

## Architecture Notes

See `architecture-update.md` for the full design. Key constraints:

- All quiz tables use the `quiz_` prefix to namespace them within the shared
  schema and avoid collisions with existing LEAGUE Report tables.
- `quizUsers` is a separate table from the existing `users` table; a quiz user
  is identified by `github_login` (students) or `pike13_email` (staff). The
  tables are linked by email for staff who use both systems.
- GitHub OAuth adds `passport` and `passport-github2` packages.
- Token links use a UUID token in the URL; the server validates expiry and
  returns questions without creating a session — the attempt is attributed on
  submission via the token.
- Student data isolation: every quiz/attempt query in the server layer includes
  a `WHERE student_id = req.quizUser.id` clause; this is enforced in the service
  layer, not just the route layer.

## GitHub Issues

None yet.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On |
|---|-------|------------|
| 001 | Quiz DB schema and migration | — |
| 002 | Quiz bank seeder | 001 |
| 003 | GitHub OAuth and quiz user model | 001 |
| 004 | Staff quiz role resolution (Pike13 extension) | 001 |
| 005 | Role-guard middleware and student isolation | 003, 004 |
| 006 | Token service (mint and resolve assignment links) | 001 |
| 007 | Quiz sampler service | 002 |
| 008 | Grader service | 001 |
| 009 | Student quiz API routes | 005, 006, 007, 008 |
| 010 | Instructor quiz API routes | 005, 006, 007 |
| 011 | Admin past-quizzes API route | 005 |
| 012 | Frontend — student GitHub login and dashboard | 009 |
| 013 | Frontend — quiz-taking view and result view | 009, 012 |
| 014 | Frontend — instructor quiz tab | 010, 012 |
| 015 | Frontend — admin past-quizzes page | 011, 012 |
| 016 | DB and server layer tests | 008, 009, 010, 011 |
| 017 | Client layer tests and e2e smoke test | 013, 014, 015, 016 |

**Execution order (serial, each depends on the prior group):**
- Group 1: 001
- Group 2: 002, 003, 004 (parallel)
- Group 3: 005, 006, 007, 008 (parallel)
- Group 4: 009, 010, 011 (parallel)
- Group 5: 012
- Group 6: 013, 014, 015 (parallel)
- Group 7: 016
- Group 8: 017
