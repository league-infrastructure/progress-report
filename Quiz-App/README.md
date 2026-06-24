# League Quiz App

A quiz/testing platform for The League of Amazing Programmers. See
**[SPEC.md](SPEC.md)** for the full specification.

## What's here today

| Path | What it is |
|------|------------|
| [SPEC.md](SPEC.md) | Authoritative specification (requirements, data model, flows, open decisions). |
| [league-quiz-app-spec.md](league-quiz-app-spec.md) | Original seed spec, kept for reference. |
| `Python-Apprentice-Quiz-Concept.json` | Curriculum concept file — 37 lessons, 460 questions (input). |
| `python-games-quiz-concepts.json` | Curriculum concept file — 6 lessons, 83 questions (input). |
| `scripts/build_quizzes.py` | Compiles concept files into served quiz banks. |
| `quizzes/` | **Generated** quiz banks (do not edit by hand — re-run the builder). |

## Quiz content (built)

The concept files are the source of truth. `build_quizzes.py` compiles them into
stable-ID quiz banks plus a placement assessment:

```bash
python3 scripts/build_quizzes.py
```

Produces in `quizzes/`:

- `python-apprentice.bank.json` — 37 lessons / 460 questions
- `python-games.bank.json` — 6 lessons / 83 questions
- `placement-assessment.json` — 40-question auto-graded placement test (8 per band)
- `index.json` — manifest with per-lesson counts

Each question has a stable id (`level/lesson/qNN`) so results, "seen" tracking,
and sampling stay consistent across rebuilds. The builder is deterministic.

## Placement assessment

A public, 40-question multiple-choice test spanning the full Python concept range
(8 questions in each of 5 ordered bands). Scoring uses the **first-unmastered-band**
rubric: the taker is placed at the start of the first band they score below 70%
on. See [SPEC.md §7](SPEC.md#7-placement-assessment-public).

## Next steps

The compiled quiz banks are stack-agnostic JSON. Building the application
(auth, repo gating, assignment, grading, Pike13/email notifications, placement
flow) is gated on the decisions in [SPEC.md §13](SPEC.md#13-open-decisions).
