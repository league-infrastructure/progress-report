#!/usr/bin/env python3
"""
build_quizzes.py — Build served quiz banks from curriculum concept files.

Inputs (committed to Quiz-App/):
  - Python-Apprentice-Quiz-Concept.json
  - python-games-quiz-concepts.json

Each input is a `level -> lessons -> {concepts, questions}` document produced by
the repo-analysis prompt (see league-quiz-app-spec.md).

Outputs (written to Quiz-App/quizzes/):
  - python-apprentice.bank.json   normalized bank, every question gets a stable id
  - python-games.bank.json
  - placement-assessment.json     40-question auto-graded placement test + rubric
  - index.json                    manifest of levels / lessons / counts

This script is the single source of truth for turning curriculum concept files
into quiz content. Re-run it whenever a concept file changes:

    python3 scripts/build_quizzes.py

It is deterministic (no randomness), so the generated banks are reproducible and
diff-friendly in version control.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

QUIZ_APP = Path(__file__).resolve().parent.parent
OUT_DIR = QUIZ_APP / "quizzes"

# (input file, level slug, repo) ; level slug is the stable identifier used in ids
SOURCES = [
    ("Python-Apprentice-Quiz-Concept.json", "python-apprentice", "Python-Apprentice"),
    ("python-games-quiz-concepts.json", "python-games", "Python-Games"),
]


def module_of(level: str, path: str, name: str) -> str:
    """Top-level module a lesson belongs to.

    Apprentice paths look like 'lessons/10_Turtles/10_Welcome' or
    'lessons/20_Types_and_Logic/10_Operators_and_Types.ipynb' -> module is the
    first path segment after 'lessons'. Games paths look like
    'lessons/03_Vectors' -> the lesson is its own module.
    """
    parts = [p for p in path.split("/") if p and p != "lessons"]
    if level == "python-apprentice" and len(parts) >= 2:
        return parts[0]
    return parts[0] if parts else name


def slugify_qid(level: str, lesson_name: str, idx: int) -> str:
    return f"{level}/{lesson_name}/q{idx:02d}"


def normalize_question(level: str, lesson_name: str, idx: int, q: dict) -> dict:
    """Normalize a raw concept-file question into the canonical bank shape."""
    return {
        "id": slugify_qid(level, lesson_name, idx),
        "type": q.get("type", "multiple_choice"),
        "category": q.get("category", "theory"),
        "question": q.get("question", "").strip(),
        "code": q.get("code"),  # may be None
        "options": q.get("options", []),  # empty for short_answer
        "answer": q.get("answer", ""),
        "explanation": q.get("explanation", ""),
        "concept_id": q.get("concept_id"),
    }


def build_bank(src_file: str, level: str, repo: str) -> dict:
    raw = json.loads((QUIZ_APP / src_file).read_text())
    lessons_out = []
    total_q = 0
    for order, lesson in enumerate(raw.get("lessons", []), start=1):
        name = lesson.get("name", f"lesson_{order}")
        path = lesson.get("path", "")
        questions = [
            normalize_question(level, name, i, q)
            for i, q in enumerate(lesson.get("questions", []), start=1)
        ]
        total_q += len(questions)
        lessons_out.append(
            {
                "id": f"{level}/{name}",
                "name": name,
                "module": module_of(level, path, name),
                "path": path,
                "order": order,
                "concepts": lesson.get("concepts", []),
                "question_count": len(questions),
                "questions": questions,
            }
        )
    return {
        "level": level,
        "repo": repo,
        "generated_from": src_file,
        "lesson_count": len(lessons_out),
        "question_count": total_q,
        "lessons": lessons_out,
    }


# ---------------------------------------------------------------------------
# Placement assessment
# ---------------------------------------------------------------------------

# Ordered placement bands. A new student is placed at the START of the first
# band they have NOT mastered (>= MASTERY_PCT correct). Bands are ordered from
# absolute beginner to most advanced across the combined curriculum.
MASTERY_PCT = 70
PLACEMENT_PER_BAND = 8  # 5 bands * 8 = 40 questions

BANDS = [
    {
        "id": "apprentice-1-turtles",
        "label": "Python Apprentice — Turtles & basics",
        "level": "python-apprentice",
        "modules": ["10_Turtles"],
        "place_at": {"level": "python-apprentice", "lesson": "lessons/10_Turtles/10_Welcome"},
    },
    {
        "id": "apprentice-2-types",
        "label": "Python Apprentice — Types & logic",
        "level": "python-apprentice",
        "modules": ["20_Types_and_Logic"],
        "place_at": {"level": "python-apprentice", "lesson": "lessons/20_Types_and_Logic/10_Operators_and_Types.ipynb"},
    },
    {
        "id": "apprentice-3-loops",
        "label": "Python Apprentice — Loops",
        "level": "python-apprentice",
        "modules": ["30_Loops"],
        "place_at": {"level": "python-apprentice", "lesson": "lessons/30_Loops/10_Iteration.ipynb"},
    },
    {
        "id": "apprentice-4-data-func",
        "label": "Python Apprentice — Data structures & functions",
        "level": "python-apprentice",
        "modules": ["40_Data_Structures_Func"],
        "place_at": {"level": "python-apprentice", "lesson": "lessons/40_Data_Structures_Func/10_Functions.ipynb"},
    },
    {
        "id": "games",
        "label": "Python Games — OOP, vectors, sprites",
        "level": "python-games",
        "modules": None,  # any games lesson
        "place_at": {"level": "python-games", "lesson": "lessons/01_Physics_for_Games"},
    },
]

# Where a student lands if they master EVERY band.
PLACED_BEYOND = {
    "level": "python-games",
    "lesson": "complete",
    "note": "Mastered all assessed Python content — ready for Python Games projects or the next level (Java). Recommend instructor review.",
}


def pick_placement_questions(banks: dict[str, dict]) -> list[dict]:
    """Select 40 auto-gradable (multiple_choice) questions stratified by band.

    Within each band we round-robin across that band's lessons to maximize
    concept coverage, deterministically (curriculum order, no randomness).
    """
    selected: list[dict] = []
    for band in BANDS:
        bank = banks[band["level"]]
        # lessons belonging to this band, in curriculum order
        band_lessons = [
            L for L in bank["lessons"]
            if band["modules"] is None or L["module"] in band["modules"]
        ]
        # multiple-choice questions per lesson (placement is auto-graded)
        per_lesson = [
            [q for q in L["questions"] if q["type"] == "multiple_choice"]
            for L in band_lessons
        ]
        chosen: list[dict] = []
        cursor = [0] * len(per_lesson)
        # round-robin one question per lesson until the band quota is filled
        while len(chosen) < PLACEMENT_PER_BAND and any(
            cursor[i] < len(per_lesson[i]) for i in range(len(per_lesson))
        ):
            for i, qs in enumerate(per_lesson):
                if len(chosen) >= PLACEMENT_PER_BAND:
                    break
                if cursor[i] < len(qs):
                    chosen.append((band_lessons[i], qs[cursor[i]]))
                    cursor[i] += 1
        for pos, (lesson, q) in enumerate(chosen, start=1):
            selected.append(
                {
                    "id": f"placement/{band['id']}/q{pos:02d}",
                    "band": band["id"],
                    "source_question_id": q["id"],
                    "source_lesson": lesson["id"],
                    "type": "multiple_choice",
                    "category": q["category"],
                    "question": q["question"],
                    "code": q["code"],
                    "options": q["options"],
                    "answer": q["answer"],
                    "explanation": q["explanation"],
                }
            )
    return selected


def build_placement(banks: dict[str, dict]) -> dict:
    questions = pick_placement_questions(banks)
    band_counts: dict[str, int] = {}
    for q in questions:
        band_counts[q["band"]] = band_counts.get(q["band"], 0) + 1
    return {
        "name": "General Python Placement Assessment",
        "description": (
            "A 40-question multiple-choice placement test spanning the full "
            "Python Apprentice and Python Games concept range. Used to place a "
            "prospective student into the right course and starting lesson."
        ),
        "question_count": len(questions),
        "auto_graded": True,
        "mastery_pct": MASTERY_PCT,
        "collect_before_start": ["name", "email"],
        "bands": [
            {
                "id": b["id"],
                "label": b["label"],
                "level": b["level"],
                "question_count": band_counts.get(b["id"], 0),
                "place_at": b["place_at"],
            }
            for b in BANDS
        ],
        "placement_rubric": {
            "method": "first-unmastered-band",
            "mastery_pct": MASTERY_PCT,
            "explanation": (
                "Score each band as a percentage of its questions answered "
                "correctly. Walk the bands in order; the student is placed at "
                "the START of the first band scoring below the mastery "
                "threshold. If every band is mastered, use 'placed_beyond'."
            ),
            "placed_beyond": PLACED_BEYOND,
        },
        "questions": questions,
    }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    banks: dict[str, dict] = {}
    manifest_levels = []
    for src_file, level, repo in SOURCES:
        bank = build_bank(src_file, level, repo)
        banks[level] = bank
        out = OUT_DIR / f"{level}.bank.json"
        out.write_text(json.dumps(bank, indent=2) + "\n")
        manifest_levels.append(
            {
                "level": level,
                "repo": repo,
                "bank_file": out.name,
                "lesson_count": bank["lesson_count"],
                "question_count": bank["question_count"],
                "lessons": [
                    {
                        "id": L["id"],
                        "name": L["name"],
                        "module": L["module"],
                        "question_count": L["question_count"],
                    }
                    for L in bank["lessons"]
                ],
            }
        )
        print(f"  {level}: {bank['lesson_count']} lessons, {bank['question_count']} questions -> {out.name}")

    placement = build_placement(banks)
    (OUT_DIR / "placement-assessment.json").write_text(json.dumps(placement, indent=2) + "\n")
    print(f"  placement: {placement['question_count']} questions -> placement-assessment.json")

    manifest = {
        "generated_by": "scripts/build_quizzes.py",
        "quiz_format_version": 1,
        "levels": manifest_levels,
        "placement_assessment": {
            "file": "placement-assessment.json",
            "question_count": placement["question_count"],
        },
        "totals": {
            "levels": len(manifest_levels),
            "lessons": sum(l["lesson_count"] for l in manifest_levels),
            "questions": sum(l["question_count"] for l in manifest_levels),
        },
    }
    (OUT_DIR / "index.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"  manifest -> index.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
