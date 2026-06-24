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
    """Build one quiz per SECTION (top-level lesson directory, e.g. ``10_Turtles``).

    The concept files list one entry per exercise/sub-lesson; we group those by
    their section (``module``) so each section is a single quiz. Question ids stay
    stable (``level/sub-lesson/qNN``) and unique within the section.
    """
    raw = json.loads((QUIZ_APP / src_file).read_text())

    # Preserve first-seen order of sections.
    groups: "dict[str, dict]" = {}
    for lesson in raw.get("lessons", []):
        name = lesson.get("name", "")
        path = lesson.get("path", "")
        module = module_of(level, path, name)
        g = groups.setdefault(module, {"concepts": [], "questions": []})
        for i, q in enumerate(lesson.get("questions", []), start=1):
            g["questions"].append(normalize_question(level, name, i, q))
        g["concepts"].extend(lesson.get("concepts", []))

    lessons_out = []
    total_q = 0
    for order, (module, g) in enumerate(groups.items(), start=1):
        # De-duplicate concepts by id across the section's sub-lessons.
        seen_concepts = set()
        concepts = []
        for c in g["concepts"]:
            cid = c.get("id")
            if cid and cid in seen_concepts:
                continue
            if cid:
                seen_concepts.add(cid)
            concepts.append(c)
        total_q += len(g["questions"])
        lessons_out.append(
            {
                "id": f"{level}/{module}",
                "name": module,
                "module": module,
                "path": f"lessons/{module}",
                "order": order,
                "concepts": concepts,
                "question_count": len(g["questions"]),
                "questions": g["questions"],
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

# Bands are pure-Python concept tiers in increasing difficulty. Questions are
# drawn only from sections that teach the Python LANGUAGE (not turtle/pygame
# libraries or notebook/editor mechanics). A student is placed at the start of
# the first tier they have not mastered.
BANDS = [
    {
        "id": "basics",
        "label": "Python basics — types, operators & logic",
        "level": "python-apprentice",
        "modules": ["20_Types_and_Logic"],
        "place_at": {"level": "python-apprentice", "lesson": "lessons/10_Turtles"},
    },
    {
        "id": "loops",
        "label": "Loops & iteration",
        "level": "python-apprentice",
        "modules": ["30_Loops"],
        "place_at": {"level": "python-apprentice", "lesson": "lessons/30_Loops"},
    },
    {
        "id": "data-functions",
        "label": "Data structures & functions",
        "level": "python-apprentice",
        "modules": ["40_Data_Structures_Func"],
        "place_at": {"level": "python-apprentice", "lesson": "lessons/40_Data_Structures_Func"},
    },
    {
        "id": "oop",
        "label": "Classes & objects (OOP)",
        "level": "python-games",
        "modules": ["02_Classes_and_Objects"],
        "place_at": {"level": "python-games", "lesson": "lessons/02_Classes_and_Objects"},
    },
]

# Where a student lands if they master EVERY band.
PLACED_BEYOND = {
    "level": "python-games",
    "lesson": "complete",
    "note": "Mastered all assessed Python content — ready for Python Games projects or the next level (Java). Recommend instructor review.",
}


PLACEMENT_TOTAL = 40

# The placement test must measure PURE Python knowledge — not library APIs
# (turtle, pygame), notebook/ipynb mechanics, or editor/keyboard/environment
# trivia. Questions mentioning any of these terms (or tagged game_dev) are excluded.
EXCLUDE_TERMS = [
    # turtle graphics
    "turtle", "tina", "pencolor", "pendown", "penup", ".forward(", ".left(",
    ".right(", ".backward(", "exitonclick", "exit on click", "setup(",
    # pygame / game dev
    "pygame", "sprite", "blit", "surface", "rect", "screen", "vector",
    "velocity", "collision", "collide", "pixel",
    # notebook / editor / environment / keyboard
    "notebook", "jupyter", "ipynb", "kernel", "vscode", "visual studio",
    "codespace", "keyboard", "shortcut", "ctrl", "cmd+", "green button",
    "play button", "run button", "click run", "press run", "league code server",
    "run the program", "run programs", "run the cell", "run cell",
]


def is_pure_python(q: dict) -> bool:
    """True if the question tests core Python and not a library/editor/notebook."""
    if q.get("category") == "game_dev":
        return False
    blob = " ".join(
        [
            q.get("question", "") or "",
            q.get("code") or "",
            " ".join(q.get("options") or []),
            q.get("answer", "") or "",
        ]
    ).lower()
    return not any(term in blob for term in EXCLUDE_TERMS)


def pick_placement_questions(banks: dict[str, dict]) -> list[dict]:
    """Select PLACEMENT_TOTAL pure-Python multiple-choice questions, balanced
    across the bands. Within a band we round-robin across lessons for concept
    spread; across bands we round-robin to keep representation even and fill to
    the target. Deterministic (curriculum order, no randomness)."""
    # Pure-Python MC candidates per band, grouped by concept for spread.
    candidates: dict[str, list] = {}
    for band in BANDS:
        bank = banks[band["level"]]
        band_lessons = [
            L for L in bank["lessons"]
            if band["modules"] is None or L["module"] in band["modules"]
        ]
        lesson_by_qid = {q["id"]: L["id"] for L in band_lessons for q in L["questions"]}
        by_concept: dict[str, list] = {}
        for L in band_lessons:
            for q in L["questions"]:
                if q["type"] == "multiple_choice" and is_pure_python(q):
                    by_concept.setdefault(q.get("concept_id") or "_", []).append(q)
        concept_keys = sorted(by_concept.keys())
        ordered: list = []
        ccur = {k: 0 for k in concept_keys}
        progressed = True
        while progressed:
            progressed = False
            for k in concept_keys:
                if ccur[k] < len(by_concept[k]):
                    q = by_concept[k][ccur[k]]
                    ordered.append((lesson_by_qid[q["id"]], q))
                    ccur[k] += 1
                    progressed = True
        candidates[band["id"]] = ordered

    # Round-robin across bands to fill up to PLACEMENT_TOTAL.
    picked: dict[str, list] = {b["id"]: [] for b in BANDS}
    band_cursor = {b["id"]: 0 for b in BANDS}
    total = 0
    progressed = True
    while total < PLACEMENT_TOTAL and progressed:
        progressed = False
        for band in BANDS:
            if total >= PLACEMENT_TOTAL:
                break
            bid = band["id"]
            if band_cursor[bid] < len(candidates[bid]):
                picked[bid].append(candidates[bid][band_cursor[bid]])
                band_cursor[bid] += 1
                total += 1
                progressed = True

    selected: list[dict] = []
    for band in BANDS:
        for pos, (lesson, q) in enumerate(picked[band["id"]], start=1):
            selected.append(
                {
                    "id": f"placement/{band['id']}/q{pos:02d}",
                    "band": band["id"],
                    "source_question_id": q["id"],
                    "source_lesson": lesson,
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
