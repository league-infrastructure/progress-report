# League Quiz Application — Build Spec

A guide for Claude CLI to scaffold a quiz/testing platform for League of Amazing Programmers students.

## Purpose

Students are tested on their knowledge as they progress through the League curriculum
(https://curriculum.jointheleague.org). Instructors assign AI-generated quizzes scoped
to a student's current level and concepts. Passing (>= 70%) unlocks the next level,
celebrates the student with badges, and notifies the parent via a Pike13 note.

## Stack

- **Backend:** Python + FastAPI
- **Database:** PostgreSQL (SQLAlchemy + Alembic migrations)
- **Auth:** GitHub OAuth (students and instructors log in via GitHub)
- **AI:** Anthropic API for quiz generation
- **Notifications:** Pike13 note on pass (swappable; email fallback)
- **Frontend:** React (Vite) + Tailwind, or server-rendered Jinja2 if a lighter build is preferred

## Curriculum Levels in Scope

- Python Apprentice
- Python Games
- All Java levels

## Curriculum Content Strategy (IMPORTANT)

The deployed app does **not** call GitHub or Claude CLI at runtime to read repos.
Instead, curriculum content is **pre-processed into concept files** committed to the app.

### How it works

1. For each level, a human (with Claude's help) generates a concept summary per repo/topic.
2. These are stored as structured files: `curriculum/<level>/<concept>.md` or a single
   `curriculum/<level>.json`.
3. At quiz-generation time, the app loads the relevant concept files and passes them to the
   Anthropic API as context to generate questions.

### Concept file schema (JSON form)

Curriculum is organized as **levels → lessons → questions**. Each lesson directory in a
repo (e.g. `01_Physics_for_Games`, `30_Loops`) becomes one quiz. The repo-analysis prompt
produces this per repo; `Projects` directories and hidden/config dirs (e.g. `.jtl`) are
skipped.

```json
{
  "level": "python-games",
  "repo": "python-games",
  "lessons": [
    {
      "name": "03_Vectors",
      "path": "lessons/03_Vectors",
      "concepts": [
        {
          "id": "vectors-01",
          "name": "Vector Addition",
          "summary": "Plain-language explanation of the concept.",
          "key_points": ["components", "adding vectors", "movement"],
          "example_code": "pos = pos + velocity"
        }
      ],
      "questions": [
        {
          "type": "multiple_choice",
          "category": "game_dev",
          "question": "...",
          "code": "...",
          "options": ["...", "..."],
          "answer": "...",
          "explanation": "...",
          "concept_id": "vectors-01"
        }
      ]
    }
  ]
}
```

> Action item for the League: run the repo-analysis prompt on each repo (Python Apprentice,
> Python Games, each Java level). Each lesson should contain 10-20 questions. These files are
> the curriculum source of truth for the app.

## Roles & Permissions

| Role       | Capabilities                                                      |
|------------|-------------------------------------------------------------------|
| Student    | Log in, take assigned quizzes, view own results & badges          |
| Instructor | All student abilities + assign quizzes, set level, view rosters   |
| Admin      | Manage instructors, manage curriculum files, system config        |

Role is determined at login (GitHub identity mapped to a role in the DB).

## Core Flows

### 1. Login (GitHub OAuth)
- Student/instructor authenticates via GitHub.
- On first login, create a user record; assign default role `student`.
- Instructors/admins are promoted manually or via an allowlist.

### 2. Quiz Assignment (Instructor)
- Instructor selects a student and a **lesson** (within the student's level).
- App randomly samples **10 questions** from that lesson's 10-20 question set, excluding
  ones the student has already seen where possible.
- Quiz is saved and marked "assigned" to that student.

### 3. Question Sets & Quiz Generation

Questions are authored per lesson by the repo-analysis prompt (10-20 per lesson) and stored
in the DB. The app does **not** call the AI when assigning a quiz — it samples from the
lesson's existing questions.

**A. Load the question sets (once per repo, refreshed when curriculum changes)**
- Source: the `questions` array inside each lesson of the concept files.
- Each lesson should have **10-20 questions**, mixing coding/syntax and theory (plus
  game-development questions for the Python Games repo).
- All questions for a lesson are treated as one difficulty; variety comes from concept
  coverage, not easy-vs-hard.
- Store questions in a `Question` table, tagged by level, lesson, concept, and category.

**B. Sample a quiz (per assignment / attempt)**
- **Every quiz is exactly 10 questions**, randomly sampled from the chosen lesson's set.
- Spread the sample across the lesson's concepts (don't cluster on one concept).
- **Retries favor unseen questions:** prefer questions the student hasn't answered; if fewer
  than 10 unseen remain, top up with least-recently-seen ones.
- Each attempt samples fresh, so retries differ and two students on the same lesson get
  different quizzes.
- Question types: multiple choice + short answer (auto-graded where deterministic).

### 4. Taking the Quiz (Student)
- Student opens assigned quiz, answers, submits.
- App grades: score = correct / 10 * 100 (each question worth 10 points).

### 5. Pass/Fail (>= 70%)
- **Pass:** record result, award badge, advance eligible level, send Pike13 note to parent.
- **Fail:** record result, allow instructor to reassign/retry.

### 6. Parent Notification (Pike13)
- On pass, post a note to the student's Pike13 record summarizing the result.
- Implement behind a `Notifier` interface so email can be swapped in.
- **Verify:** confirm Pike13 API access/write-notes capability for your account. If unavailable, fall back to email.

### 7. Recognition / Badges
- Award badges on pass (e.g., "Python Apprentice — Loops Mastered").
- Display on a student profile/dashboard.

## Data Model (initial)

- **User**: id, github_id, name, email, role, current_level, pike13_id
- **Level**: id, name, slug, order
- **Lesson**: id, level_id, name, path, order
- **Concept**: id, lesson_id, name, summary (or loaded from files)
- **Question**: id, lesson_id, concept_id, type, category (coding|theory|game_dev), question, code, options(JSON), answer, explanation
- **Quiz**: id, student_id, instructor_id, lesson_id, status, created_at, question_ids(JSON, the 10 sampled)
- **Attempt**: id, quiz_id, student_id, answers(JSON), score, passed, submitted_at
- **SeenQuestion**: id, student_id, question_id, last_seen_at  (drives retry variety)
- **Badge**: id, name, lesson_id
- **BadgeAward**: id, student_id, badge_id, awarded_at

## Suggested Project Structure

```
league-quiz/
├── app/
│   ├── main.py                # FastAPI entrypoint
│   ├── auth/                  # GitHub OAuth
│   ├── models/                # SQLAlchemy models
│   ├── routers/               # students, instructors, quizzes, auth
│   ├── services/
│   │   ├── quiz_generator.py  # Anthropic API quiz generation
│   │   ├── grader.py
│   │   ├── badges.py
│   │   └── notifier.py        # Pike13 note (email fallback)
│   ├── curriculum/            # concept files per level
│   └── schemas/               # Pydantic models
├── alembic/                   # migrations
├── frontend/                  # React app (if used)
├── tests/
├── .env.example
├── requirements.txt
└── README.md
```

## Environment Variables (.env.example)

```
DATABASE_URL=postgresql://user:pass@localhost/league_quiz
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
ANTHROPIC_API_KEY=
PIKE13_API_KEY=
PIKE13_BASE_URL=
SECRET_KEY=
INSTRUCTOR_ALLOWLIST=user1,user2
```

## Build Order for Claude CLI

1. Scaffold FastAPI project + Postgres + Alembic.
2. Define data models and run initial migration.
3. Implement GitHub OAuth and role assignment.
4. Add curriculum loader (reads concept files).
5. Implement quiz generation service (Anthropic API, JSON-only output).
6. Implement quiz assignment + taking + grading endpoints.
7. Implement pass logic: badges + level advance.
8. Implement `Notifier` (Pike13 note, email fallback).
9. Build frontend dashboards (student / instructor).
10. Tests + seed data + README.

## Open Items to Confirm

- Pike13 write-notes API availability (else use email).
- How parent contact is linked (Pike13 record vs. stored email).
- Whether short-answer questions need AI-assisted grading or stay multiple-choice only.
- Frontend choice: React vs. server-rendered.
