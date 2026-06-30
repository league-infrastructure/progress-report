---
id: '010'
title: "Wave 10 \u2014 Gate quiz assignment on GitHub recipe completion (with instructor\
  \ bypass)"
status: done
use-cases: []
depends-on:
- '004'
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Wave 10 — Gate quiz assignment on GitHub recipe completion (with instructor bypass)

## Description

A student should only be given a quiz for a directory (e.g. `30_Loops`) once
they have completed **every recipe file** in that directory. Completion is read
from the student's **GitHub fork** of the LEAGUE org repo for that level.

"Completed" = the expected recipe file exists in the student's fork **and its
contents differ from the starter** (the canonical org repo's version of that
file). A file that's missing or byte-identical to the starter is not complete.

On assign, if any required recipes are incomplete, the assignment is **blocked**
and the instructor receives a message listing exactly which recipes the student
still needs to finish. The instructor may use the existing **bypass** option to
assign anyway.

**Source of truth & mapping:**
- Canonical course repo = `league-curriculum/<repo>` (level's `repo`, e.g.
  `Python-Apprentice`). Required file set = the listing of `<canonical>/<lessonPath>`.
- Lesson directory = the lesson's `path` (e.g. `lessons/30_Loops`).
- Student repo is **discovered the same way as the progress report** — from the
  student's GitHub events feed filtered to LEAGUE repos (shared helper
  `services/github.ts`), NOT a hardcoded `<username>/<repo>` name. The gate then
  picks whichever discovered repo contains the lesson directory (trying both
  `<lessonPath>` and the `lessons/`-stripped short path for module repos).
- GitHub reads use the existing `GITHUB_TOKEN`.
- Caveat (inherited from the report's model): discovery relies on recent public
  push activity; a student with no recent/public LEAGUE pushes yields
  `checked:false` → blocked, and the instructor uses bypass.

Parent/guardian email is sourced from Pike13 (`students.guardianEmail`), not
entered manually (related cleanup also in this change).

## Acceptance Criteria

- [ ] `quiz_levels` gains a `repo` text column (e.g. `Python-Apprentice`), seeded
      from `Quiz-App/quizzes/index.json`; migration applies cleanly.
- [ ] New service `checkRecipeCompletion(level, lessonPath, githubUsername)`:
      lists required files from the canonical org repo directory, then for each
      compares the student fork's file to the starter; returns
      `{ complete: boolean, incomplete: string[], checked: boolean }`.
      Network/repo-missing errors are surfaced as `checked: false` (don't crash
      the assign flow), and the route treats "could not check" distinctly.
- [ ] `POST /api/quiz/instructor/assign` runs the completion check before
      creating the quiz, UNLESS a `bypassReason` is provided. If incomplete, it
      returns HTTP 409 with `{ error, incomplete: string[], checked }`.
- [ ] The instructor quiz tab shows the returned message listing the incomplete
      recipes, and the existing "Bypass completion gate" checkbox lets the
      instructor assign anyway.
- [ ] GitHub auth uses `GITHUB_TOKEN`; calls are limited (one dir listing +
      per-file compares) and tolerate a missing fork (reported as incomplete /
      not-checked, never a 500).
- [ ] Manual parent-email entry is removed from the add-student flow; the
      parent-note review reads `students.guardianEmail` (Pike13) only.

## Testing

- **Existing tests to run**: `tests/server/quiz-*.test.ts`, full client suite.
- **New tests to write**:
  - Service: with a mocked GitHub client — all files changed → complete; a
    missing file and an identical-to-starter file → both reported incomplete;
    missing fork → `checked:false`.
  - Route: assign without bypass + incomplete → 409 with the list; assign with
    bypass → creates the quiz regardless; assign when complete → creates.
- **Verification command**: `npm run test:server` and the client vitest run.
