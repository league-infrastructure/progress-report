# League Quiz Application — Specification

> Status: **Draft v1** · Supersedes the seed in [`league-quiz-app-spec.md`](league-quiz-app-spec.md).
> This document is the authoritative spec. The seed file is kept for reference.
> Sections marked **[DECISION]** require stakeholder confirmation before the app
> build begins (see [§13 Open Decisions](#13-open-decisions)).

## 1. Purpose

A quiz/testing platform for **The League of Amazing Programmers**. Students are
tested on their knowledge as they progress through the League curriculum
(<https://curriculum.jointheleague.org>). The platform has three jobs:

1. **Lesson quizzes** — Instructors assign per-lesson quizzes scoped to the
   work a student has actually completed in their curriculum GitHub repo.
   Passing (≥ 70%) records a result, awards a badge, and notifies the parent
   (and instructor) via a Pike13 note.
2. **Repo readiness** — The app inspects a student's curriculum repo to report
   what they have finished and what is still incomplete ("recipes" to finish),
   and uses that to gate which quizzes are offered.
3. **Placement assessment** — A public 40-question Python test that anyone can
   take to find out which course (Python Apprentice or Python Games) and which
   lesson they should start at if they join.

## 2. Curriculum Levels in Scope

| Level | Repo | Notes |
|-------|------|-------|
| Python Apprentice | `league-curriculum/Python-Apprentice` | Entry course (grades 6–10). 37 lessons. |
| Python Games | `league-curriculum/Python-Games` | OOP / game dev. 6 lessons. |
| Java levels | (various `levelN-moduleM-*`) | In scope per seed spec; **v1 build focuses on Python.** Student repos use the same `NN_`/`_NN_` numbering, so the gating engine is designed to generalize. |

## 3. Quiz Content — Built From Concept Files

Quiz content is **pre-authored** in concept files and compiled into served quiz
banks at build time. The deployed app does **not** call GitHub or the Anthropic
API to *author questions* at runtime — questions are sampled from the compiled
banks. (Runtime GitHub access is used only for **repo gating**, see §5 — a
separate concern from content authoring.)

### 3.1 Inputs (committed)

- `Python-Apprentice-Quiz-Concept.json` — 37 lessons, 460 questions
- `python-games-quiz-concepts.json` — 6 lessons, 83 questions

Each is a `level → lessons → {concepts, questions}` document. Question shape:

```json
{
  "type": "multiple_choice | short_answer",
  "category": "theory | coding | game_dev",
  "question": "…",
  "code": "… (optional code snippet)",
  "options": ["…"],          // multiple_choice only
  "answer": "…",
  "explanation": "…",
  "concept_id": "vectors-01"
}
```

### 3.2 Build step (implemented)

`scripts/build_quizzes.py` compiles the concept files into normalized, stable-ID
quiz banks. Re-run after any concept file changes:

```bash
python3 scripts/build_quizzes.py
```

### 3.3 Outputs (`quizzes/`, generated)

| File | Contents |
|------|----------|
| `python-apprentice.bank.json` | 37 lessons / 460 questions, each with a stable `id` (`level/lesson/qNN`), `module`, `path`, concepts. |
| `python-games.bank.json` | 6 lessons / 83 questions, same shape. |
| `placement-assessment.json` | 40-question auto-graded placement test + band rubric (see §7). |
| `index.json` | Manifest: levels, lessons, per-lesson question counts, totals. |

The app loads these banks into the `Question` / `Lesson` tables on startup or via
a seed command. The League already uses a sibling quiz format in each curriculum
repo at `lessons/.jtl/Quiz_Data/Module_*_Quiz.json` (`[{question, type, answers:
[{answer, correct, feedback}]}]`); a `--format league` exporter can target it if
we want quizzes to round-trip back into the curriculum repos (deferred).

## 4. Roles, Access Model & Permissions

**[DECIDED: one app, role-based.]** A single application (Express API + SQLite +
React SPA) serves all roles; surfaces are separated by role, not by a second app.
A "separate student app" was rejected because quizzes/assignments/attempts are one
shared dataset — splitting would still require a shared backend + DB, doubling
auth/deploy/ops for no real gain. The student UI and staff console may optionally
ship as two front-end bundles under the one backend.

### Three access tiers

| Tier | Who | Auth | Sees |
|------|-----|------|------|
| **Public** | Anyone (prospective students) | none (name + email) | The placement assessment only (§7). |
| **Student** | Enrolled students (minors) | **GitHub OAuth _or_ tokenized assignment link** | Only their own assigned quizzes, results, badges, readiness report. |
| **Staff** | Instructors & admins | **Pike13 OAuth** (`@jointheleague.org`) | Instructor tab / admin console (§6, §8b). |

| Role | Capabilities |
|------|--------------|
| **Student** | Sign in (GitHub) or open a tokenized quiz link, see quizzes for lessons they've completed, take assigned quizzes, view own results & badges, view their repo-readiness report. |
| **Instructor** | All student abilities + look up any student **by GitHub username**, assign any quiz (with a sharable link), **bypass the completion gate** for special circumstances, view rosters & readiness reports, **own instructor tab**. |
| **Admin** | Manage instructors, manage curriculum/quiz banks, system config, receives copies of all placement-assessment results, **past-quizzes detail page**. |

**[DECIDED: dual student access.]** Students reach a quiz two ways, both recorded
against the same student record:
- **GitHub OAuth login** — persistent identity; full dashboard (all assigned
  quizzes, history, badges, readiness). GitHub identity also drives repo gating (§5).
- **Tokenized assignment link** — when an instructor assigns a quiz, the app mints
  a unique, expiring link the student can open with **no account** (low friction
  for minors). The attempt is still tied to the student record; if the student
  later logs in with the matching GitHub account, it appears in their history.

**Role resolution:** staff roles come from Pike13 identity + an allowlist
(`INSTRUCTOR_ALLOWLIST`, `ADMIN_ALLOWLIST`); students default to role `student`.
Every route is **role-guarded server-side** and student queries are scoped to the
student's own id — students cannot reach instructor/admin routes (these users are
minors; isolation is enforced, never trusting a client-supplied role).

## 5. Repo Readiness & Completion Gating

This is the core new capability. A student should only be offered a lesson's quiz
once they've actually **done the work** in their curriculum repo.

### 5.1 What "complete" means

Curriculum exercise files contain a task described in a docstring/comment and an
unfilled solution placeholder. Example starter (`30_Turtle_Tricks/10_Turtle_Tricks.py`):

```python
# Use tina.forward() and tina.left() to draw a triangle
... # Your code here
```

A file is **complete** when the student has filled in the solution. The
`RepoInspector` marks a required exercise file **incomplete** if any hold:

- It still contains the unfilled placeholder `...` (bare ellipsis statement) or a
  `# Your code here` / `# YOUR CODE HERE` / `# TODO` marker with no implementation.
- `.py` files: the file fails to parse (`ast.parse`) **or** is byte-identical to
  the curriculum's starter version.
- `.ipynb` files: a solution code cell contains only the placeholder / is empty.

Otherwise the file is **complete**. The strongest signal is "the starter
placeholder is gone and the file differs from the starter and parses."

### 5.2 What counts as a required file

Only **numbered exercise files** count — names beginning with a number then an
underscore (`NN_…` in Python repos, `_NN_…` in Java repos). The inspector
**skips**: `README.md`, `images/`, `lib/`, `Projects/` and `*_Projects/`
directories, hidden/config dirs (`.jtl`, `.course`, `.git`, `.vscode`), and any
non-source asset.

### 5.3 Lesson eligibility (the 90% rule)

A **lesson** (a numbered `NN_Name` directory or file in `lessons/`) is **eligible**
— its quiz may be offered to the student — when **≥ 90%** of its required `NN_`
exercise files are complete. Below 90%, the quiz is hidden for that student until
they finish more (an instructor may override; §5.5).

### 5.4 Readiness report ("recipes to finish")

On demand and at assignment time, the app produces a per-student report:

```
Python Apprentice — repo: <student-github>/Python-Apprentice
  ✅ 10_Turtles/10_Welcome      3/3 complete   → quiz available
  ✅ 10_Turtles/30_Turtle_Tricks 3/3 complete  → quiz available
  ⚠️ 10_Turtles/40_Loops        2/3 complete (67%) → finish: 30_Loop_with_Turtle.py
  ⛔ 10_Turtles/80_Lists        0/2 complete   → not started
```

For each not-yet-eligible lesson it lists the specific files ("recipes") still
needing work. This report is shown to the student and to instructors.

### 5.5 Instructor bypass

An instructor assigning a quiz may set **"bypass completion check"** (with an
optional reason, logged) to assign a quiz regardless of repo state — for special
circumstances (e.g., the student did the work elsewhere, or a make-up quiz).

### 5.6 How the repo is inspected — **[DECIDED: GitHub REST API]**

The seed spec said "the deployed app does not call GitHub at runtime." That
applies to *question authoring*. Repo **gating** does require reading the
student's repo at runtime.

**Decision:** the deployed app uses the **GitHub REST API** — fetch the repo tree
+ file contents for the relevant `lessons/` paths via a server token
(`GITHUB_TOKEN`) and/or the student's OAuth token. The work sits behind a
`RepoInspector` interface so an alternative backend (local clone, or a GitHub MCP
server in dev/agent contexts) can be swapped without touching callers. No GitHub
MCP server is currently connected to this workspace (only `clasi`, Asana, Gmail,
Google Calendar/Drive, Slack), so the API path is also what unblocks development.

## 6. Lesson-Quiz Flows

### 6.1 Login
- **Students** authenticate via **GitHub OAuth** (first login creates a `User`,
  role `student`, storing `github_login`), **or** take a quiz through a tokenized
  assignment link without an account (§4). 
- **Staff** (instructors/admins) authenticate via **Pike13 OAuth**
  (`@jointheleague.org`); role comes from the allowlists.

### 6.2 Assignment (Instructor)
- Instructor finds a student **by GitHub username**, picks a **level + lesson**.
- App shows the student's readiness; eligible lessons are assignable directly,
  ineligible ones require the **bypass** toggle.
- App samples **exactly 10 questions** from the lesson's bank, spread across the
  lesson's concepts, favoring questions the student hasn't seen (top up with
  least-recently-seen when fewer than 10 unseen remain). Quiz saved as "assigned".
- Assignment mints a **tokenized link** (unique, expiring) the instructor can send
  to the student; opening it lets them take that quiz without logging in (§4).

### 6.3 Taking & grading (Student)
- Student opens the assigned quiz, answers, submits.
- Score = correct / 10 × 100 (each question worth 10 points).
- **Grading — [DECIDED: deterministic, no AI]** (fastest response, no API latency):
  - **Multiple-choice** → exact match against the correct option (all 440 MC
    answers match an option, verified).
  - **Short-answer** → **normalized** match: lowercase, trim, collapse internal
    whitespace, normalize quote characters. Handles code/single-token answers
    (e.g. `tina.pendown()`, `print("Hello World!")`).
  - A quiz samples 10 from the lesson's **full** question set (not MC-only):
    16 lessons have fewer than 10 multiple-choice questions, so MC-only sampling
    can't fill a 10-question quiz everywhere.
  - Free-prose / multi-accept short answers may grade harshly under normalized
    match; on a miss the student sees the stored `explanation`, and an
    **instructor can manually adjust** a contested score. AI-assisted grading is
    explicitly deferred (adds latency/cost).

### 6.4 Pass/fail (≥ 70%)
- **Pass (≥ 70%):** record result, award badge, mark the next level/lesson
  eligible, send Pike13 notes (§6.5).
- **Fail (< 70%):** record result; instructor may reassign/retry (retries favor
  unseen questions).

### 6.5 Notification on completion (Pike13)
On **every completed attempt**:
- Post a **Pike13 note to the student's parent/guardian** summarizing the lesson,
  the **grade (%)**, and pass/fail status.
- Send a **copy to the instructor** (Pike13 note on the instructor record or
  email).

Implemented behind a `Notifier` interface (Pike13 primary, email fallback).
**[DECIDED]:** the parent/guardian is already accessible via the **Pike13
relationship** on the student record — no separate `parent_email` field is
needed. (Pike13 write-notes capability still to be confirmed against the account
at build time; email fallback covers the gap if unavailable.)

### 6.6 Badges
- Award on pass (e.g., "Python Apprentice — Loops Mastered"); shown on the student
  dashboard.

## 7. Placement Assessment (Public)

A general Python test anyone can take to find their starting point.

- **Access:** public, unauthenticated. Before starting, the taker enters their
  **name and email**.
- **Content:** `quizzes/placement-assessment.json` — **40 multiple-choice
  questions** (auto-graded), curated by `build_quizzes.py` to span the full
  concept range, **8 questions per band** across 5 ordered bands:

  | Band | Covers | Place-at if first unmastered |
  |------|--------|------------------------------|
  | `apprentice-1-turtles` | Turtles & basics | Python Apprentice · `10_Turtles/10_Welcome` |
  | `apprentice-2-types` | Types & logic | Python Apprentice · `20_Types_and_Logic/10_Operators_and_Types` |
  | `apprentice-3-loops` | Loops | Python Apprentice · `30_Loops/10_Iteration` |
  | `apprentice-4-data-func` | Data structures & functions | Python Apprentice · `40_Data_Structures_Func/10_Functions` |
  | `games` | OOP, vectors, sprites | Python Games · `01_Physics_for_Games` |

- **Placement rubric — "first unmastered band":** score each band as a % of its
  questions correct; walk bands in order; place the student at the **start of the
  first band scoring below 70%**. If all bands are mastered, mark "placed beyond"
  (ready for Python Games projects / next level — recommend instructor review).
- **On completion:**
  1. Email the taker their score, per-band breakdown, and recommended course +
     starting lesson.
  2. Email a **copy to all Admin-role users**.

## 8. Data Model

Extends the seed model; **bold** items are new/changed for this spec.

- **User**: id, **github_login**, name, email, role (`student|instructor|admin`),
  current_level, **pike13_person_id** (parent/guardian reached via the Pike13
  relationship on this record — no separate parent_email)
- **Level**: id, name, slug, order
- **Lesson**: id, level_id, name, **module**, path, order
- **Concept**: id, lesson_id, name, summary, key_points, example_code
- **Question**: id (stable, from bank), lesson_id, concept_id, type, category,
  question, code, options(JSON), answer, explanation
- **Quiz**: id, student_id, instructor_id, lesson_id, status, **bypass_reason**,
  created_at, question_ids(JSON — the 10 sampled)
- **Attempt**: id, quiz_id, student_id, answers(JSON), score, passed, submitted_at
- **SeenQuestion**: id, student_id, question_id, last_seen_at
- **Badge** / **BadgeAward**: badge catalog + per-student awards
- **RepoScan** *(new)*: id, student_id, level, **lesson_id, files_total,
  files_complete, pct_complete, eligible(bool), detail(JSON per-file), scanned_at**
- **PlacementResult** *(new, anonymous)*: id, name, email, answers(JSON),
  band_scores(JSON), score, recommended_level, recommended_lesson, taken_at
- **NotificationLog** *(new)*: id, ref (attempt/placement), channel
  (`pike13|email`), recipient, status, sent_at

## 9. Stack — **[DECIDED: docker-node-template]**

**Decision:** build on the **docker-node-template** stack used by the League's
existing app (this `progress-report` repo, "LEAGUE Report"):

- **Backend:** Express + TypeScript
- **DB:** SQLite via Drizzle ORM (`better-sqlite3`)
- **Frontend:** Vite + React + TypeScript
- **Deploy/secrets:** Docker Swarm + Caddy + SOPS/age + rundbat
- **Auth:** add GitHub OAuth (Pike13 OAuth is already present in the template)
- **Email:** SendGrid (already configured)

Rationale: operational consistency with the existing League app — one ops model,
and Pike13 + email integration already exist to reuse. The FastAPI/Postgres path
from the seed spec is **not** being used. The compiled quiz banks (§3.3) are
stack-agnostic JSON and are unaffected by this choice.

## 10. Notifications & Integrations

- **Pike13** — lesson-quiz parent + instructor notes (§6.5). Reuse the Pike13
  client/patterns already in `progress-report` if stack B is chosen.
- **Email** — SendGrid (already configured in the LEAGUE Report app) for placement
  results (taker + all admins) and as the Pike13 fallback.
- **Anthropic API** — *not required at runtime* for v1 (questions are pre-built).
  Optional later: AI-assisted short-answer grading; regenerating concept files.

## 11. Environment Variables

```
# Auth
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_TOKEN=                 # server token for RepoInspector (option 1)
SESSION_SECRET=
INSTRUCTOR_ALLOWLIST=user1,user2
ADMIN_ALLOWLIST=adminA,adminB

# Pike13 (parent/instructor notes)
PIKE13_API_BASE=
PIKE13_CLIENT_ID=
PIKE13_CLIENT_SECRET=

# Email (placement results + fallback)
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=

# DB (stack-dependent)
DATABASE_URL=

# Optional
ANTHROPIC_API_KEY=
```

## 12. Build Order (roadmap)

1. **[done]** Compile quiz banks + placement assessment from concept files
   (`scripts/build_quizzes.py` → `quizzes/`).
2. Scaffold the backend (stack per §9) + DB schema + migrations; seed banks.
3. GitHub OAuth + role assignment (allowlists).
4. `RepoInspector` (§5) + readiness report + the 90% eligibility gate.
5. Quiz assignment (by GitHub username) + bypass + sampling + taking + grading.
6. Pass logic: badges + level/lesson advancement.
7. `Notifier`: Pike13 parent note + instructor copy (email fallback).
8. Placement assessment: public flow, auto-grade, placement rubric, result email
   to taker + all admins.
9. Frontend: student dashboard (readiness + quizzes + badges), instructor console
   (lookup, assign, bypass, rosters), admin (curriculum + config).
10. Tests + seed data + README.

## 13. Open Decisions

**Resolved:**

1. ✅ **Stack** — docker-node-template (Express + TS + SQLite/Drizzle). §9.
2. ✅ **Repo inspection mechanism** — GitHub REST API behind a `RepoInspector`
   interface. §5.6.

3. ✅ **Parent linkage** — parent/guardian is accessible via the Pike13
   relationship on the student record; no `parent_email` field needed. §6.5.
   *(Pike13 write-notes permission to be confirmed against the account at build
   time; email fallback covers the gap.)*
4. ✅ **Grading** — deterministic, no AI: MC exact match + short-answer normalized
   match, sampling from each lesson's full question set. §6.3.
5. ✅ **App architecture** — one app, role-based (not a separate student app). §4.
6. ✅ **Student access** — dual: GitHub OAuth login **and** tokenized assignment
   links; staff authenticate via Pike13 OAuth. §4, §6.1.

**Still open (don't block the spec; revisit at build time):**

7. **Where the app lives** — its own repo, or remain a subdir of `progress-report`.
   *(Sprint 1 builds in `Quiz-App/`; extraction to its own repo is reversible.)*
8. **Java levels in v1** — Python-only build first, or include Java gating now.

> **Current status:** spec + compiled quiz banks complete; access model decided.
> Proceeding to **CLASI Sprint 1** (foundation + dual student access + quiz
> assign/take/grade + instructor tab + admin past-quizzes page).

## 14. Project Structure (proposed — docker-node-template layout)

```
Quiz-App/
├── SPEC.md                         # this document
├── league-quiz-app-spec.md         # seed (reference)
├── Python-Apprentice-Quiz-Concept.json   # input
├── python-games-quiz-concepts.json       # input
├── scripts/build_quizzes.py        # concept files -> quiz banks  [done]
├── quizzes/                        # compiled banks (generated)   [done]
│   ├── python-apprentice.bank.json
│   ├── python-games.bank.json
│   ├── placement-assessment.json
│   └── index.json
├── server/                         # (to build) Express + TS
│   └── src/
│       ├── db/                     # Drizzle schema + connection
│       ├── routes/                 # auth, students, instructors, quizzes, placement
│       ├── middleware/             # auth guards, error handler
│       └── services/
│           ├── repoInspector.ts    # §5 completion gating (GitHub REST API)
│           ├── quizSampler.ts      # §6.2 10-question sampling
│           ├── grader.ts · badges.ts
│           ├── placement.ts        # §7 rubric
│           └── notifier.ts         # Pike13 + email (SendGrid)
├── client/                         # (to build) Vite + React SPA
└── tests/                          # tests/db · tests/server · tests/client · tests/e2e
```
