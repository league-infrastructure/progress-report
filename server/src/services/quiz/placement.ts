import path from 'path';
import fs from 'fs';

// Public placement assessment (Quiz-App/SPEC.md §7). Loads the compiled
// 40-question test from Quiz-App/quizzes/placement-assessment.json, serves the
// questions without answers, and grades with the "first-unmastered-band" rubric.

interface PlaceAt {
  level: string;
  lesson: string;
}
interface Band {
  id: string;
  label: string;
  level: string;
  question_count: number;
  place_at: PlaceAt;
}
interface RawQuestion {
  id: string;
  band: string;
  type: string;
  category: string;
  question: string;
  code: string | null;
  options: string[];
  answer: string;
}
interface PlacementFile {
  name: string;
  question_count: number;
  mastery_pct: number;
  bands: Band[];
  placement_rubric: {
    mastery_pct: number;
    placed_beyond: { level: string; lesson: string; note: string };
  };
  questions: RawQuestion[];
}

export type PlacementLanguage = 'python' | 'java';

// Map a requested language to its compiled placement file. Python keeps the
// legacy filename so old links and the default endpoint keep working.
const PLACEMENT_FILES: Record<PlacementLanguage, string> = {
  python: 'placement-assessment.json',
  java: 'placement-assessment.java.json',
};

export function normalizeLanguage(input?: string): PlacementLanguage {
  return input?.toLowerCase() === 'java' ? 'java' : 'python';
}

function load(language: PlacementLanguage = 'python'): PlacementFile {
  // Re-read each call so regenerated banks are served without a server restart.
  // In production QUIZ_DATA_DIR points at the copied quizzes directory; in dev
  // it is unset and we resolve relative to this file (repo root).
  //   server/src/services/quiz -> ../../../.. = repo root (same when compiled)
  const override = process.env.QUIZ_DATA_DIR;
  const quizzesDir = override
    ? path.resolve(override)
    : path.join(path.resolve(__dirname, '../../../..'), 'Quiz-App', 'quizzes');
  const file = path.join(quizzesDir, PLACEMENT_FILES[language]);
  if (!fs.existsSync(file)) {
    throw new Error(`Placement assessment not found at ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PlacementFile;
}

export interface PublicPlacementQuestion {
  id: string;
  band: string;
  type: string;
  category: string;
  question: string;
  code: string | null;
  options: string[];
}

export function getPlacement(
  language: PlacementLanguage = 'python',
): { name: string; language: PlacementLanguage; questionCount: number; questions: PublicPlacementQuestion[] } {
  const p = load(language);
  return {
    name: p.name,
    language,
    questionCount: p.question_count,
    questions: p.questions.map((q) => ({
      id: q.id,
      band: q.band,
      type: q.type,
      category: q.category,
      question: q.question,
      code: q.code,
      options: q.options,
    })),
  };
}

export interface BandScore {
  id: string;
  label: string;
  level: string;
  correct: number;
  total: number;
  pct: number;
  mastered: boolean;
}
export interface PlacementResult {
  score: number;
  correctCount: number;
  total: number;
  masteryPct: number;
  bandScores: BandScore[];
  recommended: { level: string; lesson: string; label: string; note?: string };
}

export function gradePlacement(
  answers: Record<string, string>,
  language: PlacementLanguage = 'python',
): PlacementResult {
  const p = load(language);
  const mastery = p.placement_rubric?.mastery_pct ?? p.mastery_pct ?? 70;

  const tally = new Map<string, { correct: number; total: number }>();
  let correctCount = 0;
  for (const q of p.questions) {
    const ok = (answers[q.id] ?? '').trim() === (q.answer ?? '').trim();
    if (ok) correctCount++;
    const t = tally.get(q.band) ?? { correct: 0, total: 0 };
    t.total++;
    if (ok) t.correct++;
    tally.set(q.band, t);
  }

  const total = p.questions.length;
  const score = total ? Math.round((correctCount / total) * 100) : 0;

  const bandScores: BandScore[] = p.bands.map((b) => {
    const t = tally.get(b.id) ?? { correct: 0, total: 0 };
    const pct = t.total ? Math.round((t.correct / t.total) * 100) : 0;
    return { id: b.id, label: b.label, level: b.level, correct: t.correct, total: t.total, pct, mastered: pct >= mastery };
  });

  // First band (in curriculum order) the student has NOT mastered.
  const firstUnmastered = p.bands.find((b) => {
    const t = tally.get(b.id) ?? { correct: 0, total: 0 };
    const pct = t.total ? (t.correct / t.total) * 100 : 0;
    return pct < mastery;
  });

  const recommended = firstUnmastered
    ? { level: firstUnmastered.place_at.level, lesson: firstUnmastered.place_at.lesson, label: firstUnmastered.label }
    : {
        level: p.placement_rubric.placed_beyond.level,
        lesson: p.placement_rubric.placed_beyond.lesson,
        label: 'Beyond the assessed material',
        note: p.placement_rubric.placed_beyond.note,
      };

  return { score, correctCount, total, masteryPct: mastery, bandScores, recommended };
}
