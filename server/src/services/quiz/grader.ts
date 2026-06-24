import type { QuizQuestion } from '../../db/schema';

// Deterministic, no-AI grading (Quiz-App/SPEC.md §6.3).
// Multiple-choice: exact match against the correct option.
// Short-answer: normalized match (case, whitespace, quote characters).

export const PASS_THRESHOLD = 70;

export interface QuestionResult {
  questionId: string;
  correct: boolean;
  studentAnswer: string;
  correctAnswer: string;
  explanation: string;
}

export interface GradeResult {
  score: number; // 0..100, rounded
  passed: boolean; // score >= PASS_THRESHOLD
  correctCount: number;
  total: number;
  results: QuestionResult[];
}

export function normalizeAnswer(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[‘’‛′`]/g, "'") // curly/backtick single quotes -> '
    .replace(/[“”″]/g, '"'); // curly double quotes -> "
}

export function isCorrect(
  question: Pick<QuizQuestion, 'type' | 'answer'>,
  studentAnswer: string,
): boolean {
  const given = studentAnswer ?? '';
  if (question.type === 'multiple_choice') {
    return given.trim() === (question.answer ?? '').trim();
  }
  // short_answer (and any non-MC type): normalized comparison
  return normalizeAnswer(given) === normalizeAnswer(question.answer ?? '');
}

export function gradeAttempt(
  questions: QuizQuestion[],
  answers: Record<string, string>,
): GradeResult {
  const total = questions.length;
  const results: QuestionResult[] = questions.map((q) => {
    const studentAnswer = answers[q.id] ?? '';
    return {
      questionId: q.id,
      correct: isCorrect(q, studentAnswer),
      studentAnswer,
      correctAnswer: q.answer,
      explanation: q.explanation,
    };
  });
  const correctCount = results.filter((r) => r.correct).length;
  const score = total === 0 ? 0 : Math.round((correctCount / total) * 100);
  return { score, passed: score >= PASS_THRESHOLD, correctCount, total, results };
}
