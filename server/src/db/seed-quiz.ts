/**
 * seed-quiz.ts — Idempotent seeder for quiz_levels, quiz_lessons, quiz_questions.
 *
 * Reads Quiz-App/quizzes/index.json and the per-level bank files, then upserts
 * all records keyed on their stable IDs. Safe to run repeatedly; exits early
 * (no-op) if questions are already present.
 *
 * Usage: ts-node src/db/seed-quiz.ts  (or via npm run seed:quiz)
 */

import path from 'path';
import fs from 'fs';
import { db } from './index';
import {
  quizLevels,
  quizLessons,
  quizQuestions,
  quizzes,
  quizAttempts,
  quizSeenQuestions,
  quizAssignmentTokens,
} from './schema';
import { eq, count } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types matching the compiled bank JSON shape
// ---------------------------------------------------------------------------

interface BankQuestion {
  id: string;
  type: string;
  category: string;
  question: string;
  code: string | null;
  options: string[] | null;
  answer: string;
  explanation: string;
  concept_id?: string;
}

interface BankLesson {
  id: string;
  name: string;
  module: string;
  path: string;
  order: number;
  question_count: number;
  questions: BankQuestion[];
}

interface BankFile {
  level: string;
  lesson_count: number;
  question_count: number;
  lessons: BankLesson[];
}

interface IndexLevel {
  level: string;
  repo: string;
  bank_file: string;
  lesson_count: number;
  question_count: number;
}

interface IndexFile {
  levels: IndexLevel[];
  totals: {
    levels: number;
    lessons: number;
    questions: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the Quiz-App/quizzes directory.
 *
 * In production the source tree is flattened into the image (dist lives at
 * /app/dist, with no `server/` parent), so the relative walk-up that works in
 * dev no longer points at the data. The Docker image therefore sets
 * QUIZ_DATA_DIR to the absolute location of the copied quizzes directory and
 * both this seeder and the placement loader honour it.
 *
 *   dev (ts-node):  server/src/db/seed-quiz.ts  → ../../.. → repo root
 *   dev (compiled): server/dist/db/seed-quiz.js → ../../.. → repo root
 *   prod:           QUIZ_DATA_DIR=/app/Quiz-App/quizzes
 */
function resolveQuizzesDir(): string {
  const override = process.env.QUIZ_DATA_DIR;
  const candidate = override
    ? path.resolve(override)
    : path.join(path.resolve(__dirname, '../../..'), 'Quiz-App', 'quizzes');
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `Quiz bank directory not found at expected path: ${candidate}\n` +
        (override
          ? 'QUIZ_DATA_DIR is set but does not exist in the image.'
          : 'Ensure the Quiz-App/ directory is present at the repository root.'),
    );
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Main seeder
// ---------------------------------------------------------------------------

export async function seedQuiz(opts: { reset?: boolean } = {}): Promise<void> {
  const quizzesDir = resolveQuizzesDir();
  const indexPath = path.join(quizzesDir, 'index.json');
  const index: IndexFile = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  if (opts.reset) {
    // Clear quiz curriculum + dependent quiz data so the banks can be re-seeded
    // (e.g. after the section grouping changed). FK-safe order: children first.
    await db.delete(quizSeenQuestions);
    await db.delete(quizAttempts);
    await db.delete(quizAssignmentTokens);
    await db.delete(quizzes);
    await db.delete(quizQuestions);
    await db.delete(quizLessons);
    await db.delete(quizLevels);
    console.log('[seed-quiz] Reset: cleared existing quiz curriculum + data.');
  } else {
    // --- Guard: skip only when every level in the index is already present ---
    // The seed loop is fully idempotent (every insert is onConflictDoUpdate), so
    // re-running is safe and never touches student quizzes/attempts. We skip the
    // work only when there's nothing new to add — i.e. all index levels already
    // exist. This lets a NEW level (e.g. Java added to an existing Python-only
    // deployment) be seeded additively on boot without a destructive --reset.
    const existingLevels = await db.select({ slug: quizLevels.slug }).from(quizLevels);
    const existingSlugs = new Set(existingLevels.map((l) => l.slug));
    const allPresent =
      index.levels.length > 0 && index.levels.every((l) => existingSlugs.has(l.level));
    if (allPresent) {
      const [{ value: existingCount }] = await db
        .select({ value: count() })
        .from(quizQuestions);
      console.log(
        `[seed-quiz] All ${index.levels.length} levels already present (${existingCount} questions). Skipping.`,
      );
      return;
    }
  }

  let totalLessons = 0;
  let totalQuestions = 0;

  for (let levelOrder = 0; levelOrder < index.levels.length; levelOrder++) {
    const indexLevel = index.levels[levelOrder];
    const bankPath = path.join(quizzesDir, indexLevel.bank_file);

    if (!fs.existsSync(bankPath)) {
      console.warn(`[seed-quiz] Bank file not found, skipping: ${bankPath}`);
      continue;
    }

    const bank: BankFile = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
    const levelSlug = indexLevel.level;

    // Upsert the quiz level (keyed on slug)
    await db
      .insert(quizLevels)
      .values({
        slug: levelSlug,
        name: levelSlug
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' '),
        repo: indexLevel.repo,
        order: levelOrder + 1,
      })
      .onConflictDoUpdate({
        target: quizLevels.slug,
        set: {
          name: levelSlug
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' '),
          repo: indexLevel.repo,
          order: levelOrder + 1,
        },
      });

    // Fetch the row to get the DB-assigned id
    const [levelRow] = await db
      .select()
      .from(quizLevels)
      .where(eq(quizLevels.slug, levelSlug));

    // Upsert lessons and their questions
    for (const lesson of bank.lessons) {
      // Upsert lesson (keyed on levelId + name)
      await db
        .insert(quizLessons)
        .values({
          levelId: levelRow.id,
          name: lesson.name,
          module: lesson.module,
          path: lesson.path,
          order: lesson.order,
        })
        .onConflictDoUpdate({
          target: [quizLessons.levelId, quizLessons.name],
          set: {
            module: lesson.module,
            path: lesson.path,
            order: lesson.order,
          },
        });

      const [lessonRow] = await db
        .select()
        .from(quizLessons)
        .where(
          eq(quizLessons.levelId, levelRow.id),
        )
        .then((rows) => rows.filter((r) => r.name === lesson.name));

      // Upsert questions (keyed on their stable text id)
      for (const q of lesson.questions) {
        await db
          .insert(quizQuestions)
          .values({
            id: q.id,
            lessonId: lessonRow.id,
            conceptId: q.concept_id ?? null,
            type: q.type,
            category: q.category,
            question: q.question,
            code: q.code ?? null,
            options: q.options ?? null,
            answer: q.answer,
            explanation: q.explanation,
          })
          .onConflictDoUpdate({
            target: quizQuestions.id,
            set: {
              lessonId: lessonRow.id,
              conceptId: q.concept_id ?? null,
              type: q.type,
              category: q.category,
              question: q.question,
              code: q.code ?? null,
              options: q.options ?? null,
              answer: q.answer,
              explanation: q.explanation,
            },
          });
      }

      totalQuestions += lesson.questions.length;
      totalLessons++;
    }

    console.log(
      `[seed-quiz] Level "${levelSlug}": ${bank.lesson_count} lessons, ${bank.question_count} questions seeded.`,
    );
  }

  console.log(
    `[seed-quiz] Done. Totals: ${index.levels.length} levels, ${totalLessons} lessons, ${totalQuestions} questions.`,
  );
}

// ---------------------------------------------------------------------------
// CLI entry-point
// ---------------------------------------------------------------------------

if (require.main === module) {
  seedQuiz({ reset: process.argv.includes('--reset') })
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error('[seed-quiz] Fatal error:', err);
      process.exit(1);
    });
}
