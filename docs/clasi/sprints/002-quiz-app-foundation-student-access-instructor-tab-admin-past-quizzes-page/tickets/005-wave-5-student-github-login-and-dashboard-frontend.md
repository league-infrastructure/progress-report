---
id: '005'
title: "Wave 5 \u2014 Student GitHub login and dashboard (frontend)"
status: in-progress
use-cases: []
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
summary: 'Student dashboard at /quiz/dashboard (the GitHub-OAuth callback redirect
  target). Lists the logged-in student''s assigned quizzes via GET /api/quiz/student/quizzes,
  lets them take an assigned quiz (questions + submit) and shows completed ones with
  a badge. Self-guards on API 401 by redirecting to /api/auth/github. New: client/src/pages/StudentDashboardPage.tsx,
  route in client/src/App.tsx, tests/client/StudentDashboardPage.test.tsx (4 tests,
  passing). Note: 20 pre-existing failures in other client suites belong to in-progress
  tickets 006/008, not this ticket.'
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Wave 5 — Student GitHub login and dashboard (frontend)

## Description

(What needs to be done and why.)

## Acceptance Criteria

- [ ] (Criterion)

## Testing

- **Existing tests to run**: (list test files/commands to verify no regressions)
- **New tests to write**: (describe tests that validate this ticket's changes)
- **Verification command**: `uv run pytest`
