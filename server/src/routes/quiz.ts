import { Router } from 'express';
import { eq, and, inArray, desc, gte, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import {
  quizzes,
  quizAttempts,
  quizQuestions,
  quizLessons,
  quizLevels,
  students,
  instructorStudents,
  type QuizQuestion,
} from '../db/schema';
import { requireQuizRole, assertOwnQuiz, QuizAccessError } from '../middleware/quizAuth';
import { sampleQuestions, markSeen } from '../services/quiz/sampler';
import { gradeAttempt } from '../services/quiz/grader';
import { mintToken, resolveToken, consumeToken, TokenError } from '../services/quiz/tokenizer';
import { getPlacement, gradePlacement } from '../services/quiz/placement';

export const quizRouter = Router();

// ============================================================
// Placement assessment (public, no authentication)
// ============================================================

quizRouter.get('/placement', (_req, res, next) => {
  try {
    res.json(getPlacement());
  } catch (err) {
    next(err);
  }
});

quizRouter.post('/placement/submit', (req, res, next) => {
  try {
    const { answers } = req.body as { name?: string; email?: string; answers?: Record<string, string> };
    res.json(gradePlacement(answers ?? {}));
  } catch (err) {
    next(err);
  }
});

// ---------- helpers ----------

/** Fetch a quiz's questions in stored order, stripped of answers (for taking). */
function publicQuestions(questionIds: string[]) {
  if (questionIds.length === 0) return [];
  const rows = db.select().from(quizQuestions).where(inArray(quizQuestions.id, questionIds)).all();
  const byId = new Map(rows.map((q) => [q.id, q]));
  return questionIds
    .map((id) => byId.get(id))
    .filter((q): q is QuizQuestion => Boolean(q))
    .map((q) => ({
      id: q.id,
      type: q.type,
      category: q.category,
      question: q.question,
      code: q.code,
      options: q.options ?? [],
    }));
}

/** Grade an answered quiz, record the attempt, mark questions seen, complete the quiz. */
function gradeAndRecord(
  quiz: { id: number; questionIds: string[] },
  studentId: number,
  answers: Record<string, string>,
) {
  const rows = db
    .select()
    .from(quizQuestions)
    .where(inArray(quizQuestions.id, quiz.questionIds))
    .all();
  const byId = new Map(rows.map((q) => [q.id, q]));
  const ordered = quiz.questionIds
    .map((id) => byId.get(id))
    .filter((q): q is QuizQuestion => Boolean(q));
  const result = gradeAttempt(ordered, answers);
  db.insert(quizAttempts)
    .values({ quizId: quiz.id, studentId, answers, score: result.score, passed: result.passed })
    .run();
  markSeen(studentId, quiz.questionIds);
  db.update(quizzes).set({ status: 'completed' }).where(eq(quizzes.id, quiz.id)).run();
  return result;
}

function handleKnownError(err: unknown, res: import('express').Response, next: import('express').NextFunction) {
  if (err instanceof TokenError || err instanceof QuizAccessError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  next(err);
  return true;
}

// ============================================================
// Student routes (GitHub-authenticated) — scoped to own studentId
// ============================================================

quizRouter.get('/student/quizzes', requireQuizRole('student'), (req, res, next) => {
  try {
    const studentId = req.session.quizUser!.studentId!;
    const rows = db
      .select({
        id: quizzes.id,
        status: quizzes.status,
        lessonId: quizzes.lessonId,
        lessonName: quizLessons.name,
        module: quizLessons.module,
        levelId: quizLessons.levelId,
        createdAt: quizzes.createdAt,
      })
      .from(quizzes)
      .innerJoin(quizLessons, eq(quizzes.lessonId, quizLessons.id))
      .where(eq(quizzes.studentId, studentId))
      .orderBy(desc(quizzes.createdAt))
      .all();
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

quizRouter.get('/student/quizzes/:id/questions', requireQuizRole('student'), (req, res, next) => {
  try {
    const studentId = req.session.quizUser!.studentId!;
    const quizId = Number(req.params.id);
    assertOwnQuiz(quizId, studentId);
    const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get()!;
    res.json({ quizId, status: quiz.status, questions: publicQuestions(quiz.questionIds) });
  } catch (err) {
    handleKnownError(err, res, next);
  }
});

quizRouter.post('/student/quizzes/:id/submit', requireQuizRole('student'), (req, res, next) => {
  try {
    const studentId = req.session.quizUser!.studentId!;
    const quizId = Number(req.params.id);
    assertOwnQuiz(quizId, studentId);
    const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get()!;
    if (quiz.status === 'completed') {
      res.status(409).json({ error: 'Quiz already submitted' });
      return;
    }
    const answers = (req.body?.answers ?? {}) as Record<string, string>;
    const result = gradeAndRecord(quiz, studentId, answers);
    res.json(result);
  } catch (err) {
    handleKnownError(err, res, next);
  }
});

quizRouter.get('/student/quizzes/:id/result', requireQuizRole('student'), (req, res, next) => {
  try {
    const studentId = req.session.quizUser!.studentId!;
    const quizId = Number(req.params.id);
    assertOwnQuiz(quizId, studentId);
    const attempt = db
      .select()
      .from(quizAttempts)
      .where(eq(quizAttempts.quizId, quizId))
      .orderBy(desc(quizAttempts.submittedAt))
      .get();
    if (!attempt) {
      res.status(404).json({ error: 'No attempt yet' });
      return;
    }
    res.json(attempt);
  } catch (err) {
    handleKnownError(err, res, next);
  }
});

// ============================================================
// Tokenized assignment links (no authentication)
// ============================================================

quizRouter.get('/token/:token', (req, res, next) => {
  try {
    const { quizId } = resolveToken(req.params.token);
    const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get()!;
    const lesson = db.select().from(quizLessons).where(eq(quizLessons.id, quiz.lessonId)).get();
    res.json({
      quizId,
      lessonName: lesson?.name ?? null,
      status: quiz.status,
      questions: publicQuestions(quiz.questionIds),
    });
  } catch (err) {
    handleKnownError(err, res, next);
  }
});

quizRouter.post('/token/:token/submit', (req, res, next) => {
  try {
    const token = req.params.token;
    const { quizId } = resolveToken(token);
    const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get()!;
    const answers = (req.body?.answers ?? {}) as Record<string, string>;
    const result = gradeAndRecord(quiz, quiz.studentId, answers);
    consumeToken(token);
    res.json(result);
  } catch (err) {
    handleKnownError(err, res, next);
  }
});

// ============================================================
// Instructor routes (instructor or admin)
// ============================================================

quizRouter.get('/instructor/students', requireQuizRole('instructor', 'admin'), (req, res, next) => {
  try {
    const github = (req.query.github as string | undefined)?.trim();
    if (!github) {
      res.status(400).json({ error: 'github query param required' });
      return;
    }
    const rows = db
      .select({ id: students.id, name: students.name, githubUsername: students.githubUsername })
      .from(students)
      .where(eq(students.githubUsername, github))
      .all();
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

quizRouter.get('/instructor/roster', requireQuizRole('instructor', 'admin'), (req, res, next) => {
  try {
    const instructorId = req.session.quizUser!.instructorId ?? -1;
    const rows = db
      .select({ id: students.id, name: students.name, githubUsername: students.githubUsername })
      .from(instructorStudents)
      .innerJoin(students, eq(instructorStudents.studentId, students.id))
      .where(eq(instructorStudents.instructorId, instructorId))
      .orderBy(students.name)
      .all();
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Add (or find) a student by GitHub username and link them to this instructor's
// roster — lets an instructor assign a quiz to any student by their GitHub name.
quizRouter.post('/instructor/students', requireQuizRole('instructor', 'admin'), (req, res, next) => {
  try {
    const { githubUsername, name } = req.body as { githubUsername?: string; name?: string };
    const gh = (githubUsername ?? '').trim();
    if (!gh) {
      res.status(400).json({ error: 'githubUsername required' });
      return;
    }
    const instructorId = req.session.quizUser!.instructorId ?? -1;
    let student = db
      .select()
      .from(students)
      .where(sql`lower(${students.githubUsername}) = lower(${gh})`)
      .get();
    if (!student) {
      const [created] = db
        .insert(students)
        .values({ name: name?.trim() || gh, githubUsername: gh })
        .returning()
        .all();
      student = created;
    }
    db.insert(instructorStudents)
      .values({ instructorId, studentId: student.id })
      .onConflictDoNothing()
      .run();
    res.status(201).json({ id: student.id, name: student.name, githubUsername: student.githubUsername });
  } catch (err) {
    next(err);
  }
});

quizRouter.get('/instructor/levels', requireQuizRole('instructor', 'admin'), (_req, res, next) => {
  try {
    const levels = db.select().from(quizLevels).orderBy(quizLevels.order).all();
    const lessons = db.select().from(quizLessons).orderBy(quizLessons.order).all();
    res.json(
      levels.map((lvl) => ({
        ...lvl,
        lessons: lessons.filter((l) => l.levelId === lvl.id),
      })),
    );
  } catch (err) {
    next(err);
  }
});

quizRouter.post('/instructor/assign', requireQuizRole('instructor', 'admin'), (req, res, next) => {
  try {
    const { studentId, lessonId, bypassReason } = req.body as {
      studentId?: number;
      lessonId?: number;
      bypassReason?: string;
    };
    if (!studentId || !lessonId) {
      res.status(400).json({ error: 'studentId and lessonId required' });
      return;
    }
    const questionIds = sampleQuestions(lessonId, studentId);
    if (questionIds.length === 0) {
      res.status(400).json({ error: 'Lesson has no questions' });
      return;
    }
    const instructorId = req.session.quizUser!.instructorId ?? null;
    const [created] = db
      .insert(quizzes)
      .values({
        studentId,
        instructorId,
        lessonId,
        status: 'assigned',
        questionIds,
        bypassReason: bypassReason ?? null,
      })
      .returning({ id: quizzes.id })
      .all();
    const token = mintToken(created.id);
    res.status(201).json({ quizId: created.id, token, tokenPath: `/quiz/t/${token}` });
  } catch (err) {
    next(err);
  }
});

quizRouter.get('/instructor/my-students', requireQuizRole('instructor', 'admin'), (req, res, next) => {
  try {
    const instructorId = req.session.quizUser!.instructorId ?? -1;
    const rows = db
      .select({
        quizId: quizzes.id,
        status: quizzes.status,
        createdAt: quizzes.createdAt,
        studentId: students.id,
        studentName: students.name,
        githubUsername: students.githubUsername,
        lessonName: quizLessons.name,
        score: quizAttempts.score,
        passed: quizAttempts.passed,
        submittedAt: quizAttempts.submittedAt,
      })
      .from(quizzes)
      .innerJoin(students, eq(quizzes.studentId, students.id))
      .innerJoin(quizLessons, eq(quizzes.lessonId, quizLessons.id))
      .leftJoin(quizAttempts, eq(quizAttempts.quizId, quizzes.id))
      .where(eq(quizzes.instructorId, instructorId))
      .orderBy(desc(quizzes.createdAt))
      .all();
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Preview a freshly-sampled quiz for a lesson WITH answers — lets an instructor
// view what a quiz looks like without assigning it or logging in as a student.
quizRouter.get('/instructor/preview', requireQuizRole('instructor', 'admin'), (req, res, next) => {
  try {
    const lessonId = Number(req.query.lessonId);
    if (!lessonId) {
      res.status(400).json({ error: 'lessonId required' });
      return;
    }
    const lesson = db.select().from(quizLessons).where(eq(quizLessons.id, lessonId)).get();
    if (!lesson) {
      res.status(404).json({ error: 'Lesson not found' });
      return;
    }
    const ids = sampleQuestions(lessonId, 0); // studentId 0 -> no seen history
    const rows = db.select().from(quizQuestions).where(inArray(quizQuestions.id, ids)).all();
    const byId = new Map(rows.map((q) => [q.id, q]));
    const questions = ids
      .map((id) => byId.get(id))
      .filter((q): q is QuizQuestion => Boolean(q))
      .map((q) => ({
        id: q.id,
        type: q.type,
        category: q.category,
        question: q.question,
        code: q.code,
        options: q.options ?? [],
        answer: q.answer,
        explanation: q.explanation,
      }));
    res.json({ lessonName: lesson.name, questions });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// Admin routes — past-quizzes detail
// ============================================================

quizRouter.get('/admin/attempts', requireQuizRole('admin'), (req, res, next) => {
  try {
    const { from, to, studentId, lessonId } = req.query as Record<string, string | undefined>;
    const conditions: SQL[] = [];
    if (from) conditions.push(gte(quizAttempts.submittedAt, new Date(from)));
    if (to) conditions.push(lte(quizAttempts.submittedAt, new Date(to)));
    if (studentId) conditions.push(eq(quizAttempts.studentId, Number(studentId)));
    if (lessonId) conditions.push(eq(quizzes.lessonId, Number(lessonId)));

    const base = db
      .select({
        attemptId: quizAttempts.id,
        quizId: quizAttempts.quizId,
        studentId: students.id,
        studentName: students.name,
        githubUsername: students.githubUsername,
        lessonName: quizLessons.name,
        levelId: quizLessons.levelId,
        score: quizAttempts.score,
        passed: quizAttempts.passed,
        answers: quizAttempts.answers,
        submittedAt: quizAttempts.submittedAt,
        questionIds: quizzes.questionIds,
        bypassReason: quizzes.bypassReason,
      })
      .from(quizAttempts)
      .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
      .innerJoin(students, eq(quizAttempts.studentId, students.id))
      .innerJoin(quizLessons, eq(quizzes.lessonId, quizLessons.id));

    const rows = (conditions.length ? base.where(and(...conditions)) : base)
      .orderBy(desc(quizAttempts.submittedAt))
      .all();
    res.json(rows);
  } catch (err) {
    next(err);
  }
});
