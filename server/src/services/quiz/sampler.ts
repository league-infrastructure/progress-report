import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { quizQuestions, quizSeenQuestions } from '../../db/schema';
import type { QuizQuestion } from '../../db/schema';

// Quiz sampling (Quiz-App/SPEC.md §6.2): exactly N questions for a lesson,
// spread across the lesson's concepts, favoring questions the student has not
// seen, topping up with least-recently-seen ones. Deterministic for a given
// (lesson, student) state.

export const QUIZ_SIZE = 10;

export function sampleQuestions(lessonId: number, studentId: number, n: number = QUIZ_SIZE): string[] {
  const questions = db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.lessonId, lessonId))
    .all();
  if (questions.length === 0) return [];

  const seen = db
    .select()
    .from(quizSeenQuestions)
    .where(eq(quizSeenQuestions.studentId, studentId))
    .all();
  const lastSeenById = new Map<string, number>();
  for (const s of seen) lastSeenById.set(s.questionId, s.lastSeenAt.getTime());

  // Group by concept so the sample spreads across concepts.
  const byConcept = new Map<string, QuizQuestion[]>();
  for (const q of questions) {
    const key = q.conceptId ?? '_';
    if (!byConcept.has(key)) byConcept.set(key, []);
    byConcept.get(key)!.push(q);
  }

  // Within each concept: unseen first (-1), then least-recently-seen; stable by id.
  for (const list of byConcept.values()) {
    list.sort((a, b) => {
      const sa = lastSeenById.has(a.id) ? lastSeenById.get(a.id)! : -1;
      const sb = lastSeenById.has(b.id) ? lastSeenById.get(b.id)! : -1;
      if (sa !== sb) return sa - sb;
      return a.id.localeCompare(b.id);
    });
  }

  // Round-robin across concepts (sorted for determinism) until we have n.
  const conceptKeys = [...byConcept.keys()].sort();
  const cursors = new Map<string, number>(conceptKeys.map((k) => [k, 0]));
  const picked: string[] = [];
  let progressed = true;
  while (picked.length < n && progressed) {
    progressed = false;
    for (const k of conceptKeys) {
      if (picked.length >= n) break;
      const list = byConcept.get(k)!;
      const idx = cursors.get(k)!;
      if (idx < list.length) {
        picked.push(list[idx].id);
        cursors.set(k, idx + 1);
        progressed = true;
      }
    }
  }
  return picked;
}

/** Record that a student has now seen these questions (drives retry variety). */
export function markSeen(studentId: number, questionIds: string[]): void {
  const now = new Date();
  for (const questionId of questionIds) {
    db.insert(quizSeenQuestions)
      .values({ studentId, questionId, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [quizSeenQuestions.studentId, quizSeenQuestions.questionId],
        set: { lastSeenAt: now },
      })
      .run();
  }
}
