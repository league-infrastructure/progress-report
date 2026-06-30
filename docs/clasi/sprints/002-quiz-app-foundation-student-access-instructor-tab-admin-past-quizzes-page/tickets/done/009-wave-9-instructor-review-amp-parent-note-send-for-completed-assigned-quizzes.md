---
id: 009
title: "Wave 9 \u2014 Instructor review & parent-note send for completed assigned\
  \ quizzes"
status: done
use-cases: []
depends-on:
- '004'
- '005'
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Wave 9 — Instructor review & parent-note send for completed assigned quizzes

## Description

Today, when a student completes an instructor-assigned quiz, the attempt is
graded and recorded but **no note is sent to anyone**. Instructors want to
review a completed quiz and then send a note about the result to the student's
parent/guardian — with the instructor in control of what goes out.

This ticket adds an **instructor review-and-send gate** for completed assigned
quizzes:

1. A parent/guardian email is stored on the **student record** (set when an
   instructor adds a student).
2. When a student completes an assigned quiz, it appears to the instructor as
   **"awaiting review"** in their quiz tab.
3. The instructor opens the completed quiz, sees the **score and per-question
   answers**, can **edit an accompanying note**, and clicks **Send to parent**.
4. The note email is sent to the student's stored parent email.
5. Sending is **re-sendable**: the instructor can edit and re-send, and the UI
   shows a **"last sent" timestamp**. Sending is not locked after the first send.

Scope is **instructor-assigned quizzes only** (not the public placement
assessment).

## Acceptance Criteria

- [ ] `students` schema gains a nullable `parentEmail` text column; a Drizzle
      migration is generated and applies cleanly.
- [ ] The "add student" instructor flow (`POST /api/quiz/instructor/students`)
      accepts and stores an optional `parentEmail`.
- [ ] `quizzes` records review state: an editable `parentNote` (text, nullable)
      and a `parentNoteSentAt` (timestamp, nullable). A completed quiz with no
      `parentNoteSentAt` is "awaiting review".
- [ ] New endpoint `GET /api/quiz/instructor/quizzes/:id/review` returns, for an
      instructor-owned completed quiz: score, per-question results (with correct
      answers — instructor view), the student name, the stored parent email, the
      current `parentNote`, and `parentNoteSentAt`.
- [ ] New endpoint `POST /api/quiz/instructor/quizzes/:id/send-parent-note`
      accepts an edited note, sends the email to the student's `parentEmail`,
      stamps `parentNoteSentAt`, and persists the note. Returns 400 if the
      student has no parent email on file. Re-sending is allowed and updates the
      timestamp.
- [ ] A new email helper (`sendParentQuizNote`) renders the LEAGUE-branded note
      with the student name, lesson, score, and the instructor's note.
      Best-effort send consistent with existing email helpers (no throw on
      misconfig; returns false when SendGrid unconfigured).
- [ ] Instructor quiz tab marks completed-but-unsent quizzes as **"Awaiting
      review"** and provides a review action that opens the review view.
- [ ] The review view shows score + answers, an editable note textarea, a
      **Send to parent** button, and (after sending) the last-sent timestamp;
      the button re-sends on subsequent clicks.
- [ ] Authorization: only the instructor who owns the quiz (or an admin) can
      view the review or send the note.

## Testing

- **Existing tests to run**: `tests/server/quiz-grader.test.ts`, the full client
  suite (`vitest run --config vitest.config.ts`), and any `tests/db` quiz tests.
- **New tests to write**:
  - Server: review endpoint returns expected shape and enforces ownership;
    send-parent-note stamps timestamp, persists note, errors without a parent
    email, and allows re-send.
  - Client: review view renders score/answers/note, Send button calls the
    endpoint, last-sent timestamp shows after send.
- **Verification command**: `npm run test:server` and the client vitest run.
