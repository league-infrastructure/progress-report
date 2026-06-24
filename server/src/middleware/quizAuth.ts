import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { quizzes } from '../db/schema';
import type { QuizRole } from '../db/schema';

// Role guards for the quiz subsystem (Quiz-App/SPEC.md §4). Students are minors:
// isolation is enforced server-side and never trusts a client-supplied role.

export function requireQuizRole(...roles: QuizRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const quizUser = req.session.quizUser;
    if (!quizUser) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    if (roles.length > 0 && !roles.includes(quizUser.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}

export class QuizAccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'QuizAccessError';
    this.status = status;
  }
}

/** Throws unless `quizId` belongs to `studentId`. Use before serving/grading a quiz. */
export function assertOwnQuiz(quizId: number, studentId: number): void {
  const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get();
  if (!quiz) throw new QuizAccessError('Quiz not found', 404);
  if (quiz.studentId !== studentId) throw new QuizAccessError('Forbidden', 403);
}
