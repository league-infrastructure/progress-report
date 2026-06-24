---
status: draft
sprint: "002"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 002 Use Cases

## SUC-001: Student logs in via GitHub OAuth

- **Actor**: Student
- **Preconditions**: Student has a GitHub account. The app has `GITHUB_CLIENT_ID`
  and `GITHUB_CLIENT_SECRET` configured.
- **Main Flow**:
  1. Student visits `/quiz/login` and clicks "Sign in with GitHub."
  2. Browser redirects to GitHub OAuth authorization page.
  3. Student grants access; GitHub redirects to `/api/auth/github/callback`.
  4. Server exchanges code for token, fetches GitHub profile
     (`login`, `name`, `email`).
  5. Server finds or creates a `quizUsers` row with `github_login` and
     `role = student`.
  6. Server creates a session with `quizRole = student` and `githubLogin`.
  7. Browser redirects to the student dashboard `/quiz/dashboard`.
- **Postconditions**: Student has an active session; their `quizUsers` row exists.
- **Acceptance Criteria**:
  - [ ] `GET /api/auth/github` initiates GitHub OAuth redirect.
  - [ ] `GET /api/auth/github/callback` creates a session on success.
  - [ ] A `quizUsers` row is created on first login with `role = student`.
  - [ ] Subsequent logins reuse the existing row without creating duplicates.
  - [ ] Session carries `githubLogin` and `quizRole = student`.

---

## SUC-002: Student takes a quiz via tokenized assignment link

- **Actor**: Student (unauthenticated)
- **Preconditions**: An instructor has assigned a quiz to this student and a
  token link has been minted. The token has not expired or been consumed.
- **Main Flow**:
  1. Student opens the tokenized URL: `/quiz/t/:token`.
  2. Server resolves the token: validates existence, expiry, and that it has
     not been consumed.
  3. Server returns the quiz's 10 questions (without answers/explanations).
  4. Student answers and submits the form.
  5. Server grades the attempt deterministically.
  6. Server records the attempt against the student record linked to the quiz.
  7. Server marks the token as consumed.
  8. Student sees the score and per-question explanations.
- **Postconditions**: An `Attempt` row exists linked to the quiz and student.
  The token is consumed. `SeenQuestion` rows are updated.
- **Acceptance Criteria**:
  - [ ] `GET /api/quiz/token/:token` returns questions for a valid token.
  - [ ] `POST /api/quiz/token/:token/submit` grades and records the attempt.
  - [ ] An expired token returns 410 Gone.
  - [ ] A consumed token returns 410 Gone.
  - [ ] The attempt is linked to the correct student ID from the quiz record.
  - [ ] Token is marked consumed after the first submission.

---

## SUC-003: Student views assigned quizzes and results on their dashboard

- **Actor**: Student (authenticated via GitHub OAuth)
- **Preconditions**: Student is logged in. At least one quiz has been assigned
  to this student.
- **Main Flow**:
  1. Student navigates to `/quiz/dashboard`.
  2. Frontend calls `GET /api/quiz/student/quizzes`.
  3. Server returns the student's assigned quizzes with status and score if
     attempted.
  4. Student clicks into a completed quiz to see per-question breakdown
     (question, their answer, correct answer, explanation).
- **Postconditions**: Student sees their quiz list and results. No other
  student's data is returned.
- **Acceptance Criteria**:
  - [ ] `GET /api/quiz/student/quizzes` returns only the authenticated
    student's quizzes.
  - [ ] Each quiz entry includes: lesson name, status (`assigned | completed`),
    score (if completed), and pass/fail.
  - [ ] `GET /api/quiz/student/quizzes/:quizId/result` returns per-question
    detail for completed quizzes owned by this student only.
  - [ ] Attempting to fetch another student's quiz returns 403.

---

## SUC-004: Instructor looks up a student and assigns a lesson quiz

- **Actor**: Instructor (authenticated via Pike13 OAuth)
- **Preconditions**: Instructor is logged in with `quizRole = instructor`.
  The target student has a `quizUsers` row with a known GitHub username.
  The lesson's quiz bank contains at least 10 questions.
- **Main Flow**:
  1. Instructor navigates to the Quiz tab on their instructor dashboard.
  2. Instructor enters a GitHub username and clicks "Look up student."
  3. Frontend calls `GET /api/quiz/instructor/students?github=<username>`.
  4. Server returns the matching student record.
  5. Instructor selects a level and lesson and clicks "Assign Quiz."
  6. Frontend calls `POST /api/quiz/instructor/assign`.
  7. Server samples 10 questions (concept-spread, favor unseen), creates a
     `Quiz` row with `status = assigned`, mints a token, returns the token URL.
  8. Instructor copies the tokenized link to share with the student.
- **Postconditions**: A `Quiz` row exists with `status = assigned`. A
  `quizAssignmentTokens` row exists with an expiry 30 days out.
- **Acceptance Criteria**:
  - [ ] `GET /api/quiz/instructor/students?github=<username>` returns the
    matching student or 404.
  - [ ] `POST /api/quiz/instructor/assign` requires `studentId`, `lessonId`.
  - [ ] Response includes a `tokenUrl` the instructor can share.
  - [ ] Sampled questions: exactly 10, spread across the lesson's concepts,
    unseen questions prioritized.
  - [ ] Non-instructor callers receive 403.

---

## SUC-005: Instructor reviews their students' quiz results on the instructor tab

- **Actor**: Instructor (authenticated via Pike13 OAuth)
- **Preconditions**: Instructor is logged in. At least one student has a quiz
  assigned or completed.
- **Main Flow**:
  1. Instructor navigates to the Quiz tab.
  2. Frontend calls `GET /api/quiz/instructor/my-students`.
  3. Server returns the instructor's students, each with their quizzes and
     attempt summaries (lesson, score, pass/fail, date).
  4. Instructor reviews the list; for each quiz they see status and score at
     a glance.
- **Postconditions**: Instructor sees only their own students' quiz data.
- **Acceptance Criteria**:
  - [ ] `GET /api/quiz/instructor/my-students` returns the instructor's student
    roster with nested quiz summaries.
  - [ ] Results for students not associated with this instructor are excluded.
  - [ ] Each quiz summary includes: lesson name, status, score (null if not yet
    taken), pass/fail, submitted_at.

---

## SUC-006: Student takes a quiz while logged in via dashboard

- **Actor**: Student (authenticated via GitHub OAuth)
- **Preconditions**: Student is logged in. A quiz with `status = assigned`
  exists for this student.
- **Main Flow**:
  1. Student sees an assigned quiz on their dashboard and clicks "Take Quiz."
  2. Frontend calls `GET /api/quiz/student/quizzes/:quizId/questions`.
  3. Server verifies the quiz belongs to this student and status is `assigned`.
  4. Server returns the 10 questions (no answers).
  5. Student answers all questions and submits.
  6. Frontend calls `POST /api/quiz/student/quizzes/:quizId/submit`.
  7. Server grades, records the attempt, updates `SeenQuestion`, returns score
     and explanations.
  8. Frontend shows the result view.
- **Postconditions**: Quiz status is `completed`. Attempt is recorded.
  `SeenQuestion` rows are updated for each question in this quiz.
- **Acceptance Criteria**:
  - [ ] `GET /api/quiz/student/quizzes/:quizId/questions` returns questions
    only for quizzes owned by the authenticated student.
  - [ ] `POST /api/quiz/student/quizzes/:quizId/submit` accepts answers and
    returns `{ score, passed, results: [{questionId, correct, explanation}] }`.
  - [ ] Score = (correct count / 10) × 100; `passed` = score ≥ 70.
  - [ ] Submitting twice returns 409 Conflict (quiz already completed).

---

## SUC-007: Admin views the past-quizzes detail page

- **Actor**: Admin (authenticated via Pike13 OAuth, in `ADMIN_ALLOWLIST`)
- **Preconditions**: Admin is logged in. At least one quiz attempt has been
  recorded.
- **Main Flow**:
  1. Admin navigates to `/admin/quiz/past-quizzes`.
  2. Frontend calls `GET /api/quiz/admin/attempts` with optional query params:
     `from`, `to` (ISO dates), `studentId`, `lessonId`.
  3. Server returns all matching attempts with full detail: student name +
     GitHub login, level, lesson, score, pass/fail, submitted_at, per-question
     answers + correct answers.
  4. Admin uses the filter controls to narrow the list.
- **Postconditions**: No data mutation. Admin sees full audit detail.
- **Acceptance Criteria**:
  - [ ] `GET /api/quiz/admin/attempts` returns all attempts when no filters.
  - [ ] `from` / `to` filter by `submitted_at` range.
  - [ ] `studentId` and `lessonId` filters work individually and combined.
  - [ ] Each row includes: student name, github_login, level, lesson, score,
    passed, submitted_at, and answers array.
  - [ ] Non-admin callers receive 403.

---

## SUC-008: Quiz levels and lessons are seeded from compiled banks

- **Actor**: System (startup seed script)
- **Preconditions**: `Quiz-App/quizzes/` contains `index.json`,
  `python-apprentice.bank.json`, and `python-games.bank.json`.
- **Main Flow**:
  1. Seed script is invoked (at startup or via `npm run seed:quiz`).
  2. Script reads `index.json` to enumerate levels and lessons.
  3. Script reads each bank file and upserts `quizLevels`, `quizLessons`, and
     `quizQuestions` rows, keyed on stable ID from the bank.
  4. Script reports counts: levels seeded, lessons seeded, questions seeded.
- **Postconditions**: DB contains 2 levels, 43 lessons, 543 questions
  (460 + 83). Re-running is idempotent (upsert by stable ID).
- **Acceptance Criteria**:
  - [ ] After seeding: `SELECT COUNT(*) FROM quiz_levels` = 2.
  - [ ] After seeding: `SELECT COUNT(*) FROM quiz_lessons` = 43.
  - [ ] After seeding: `SELECT COUNT(*) FROM quiz_questions` = 543.
  - [ ] Re-running the seed produces the same counts (no duplicates).
  - [ ] Each question row has: stable `id` from bank, `lesson_id`, `type`,
    `category`, `question`, `options` (JSON), `answer`, `explanation`.
