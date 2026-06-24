import { gradeAttempt, isCorrect, normalizeAnswer } from '../../server/src/services/quiz/grader';
import type { QuizQuestion } from '../../server/src/db/schema';

function mc(id: string, answer: string): QuizQuestion {
  return {
    id,
    lessonId: 1,
    conceptId: null,
    type: 'multiple_choice',
    category: 'theory',
    question: 'q',
    code: null,
    options: [answer, 'distractor-1', 'distractor-2', 'distractor-3'],
    answer,
    explanation: 'because',
  };
}

function sa(id: string, answer: string): QuizQuestion {
  return {
    id,
    lessonId: 1,
    conceptId: null,
    type: 'short_answer',
    category: 'coding',
    question: 'q',
    code: null,
    options: null,
    answer,
    explanation: 'because',
  };
}

describe('quiz grader (deterministic, no AI)', () => {
  it('scores multiple choice by exact match: 8/10 -> 80, pass', () => {
    const qs = Array.from({ length: 10 }, (_, i) => mc(`q${i}`, `ans${i}`));
    const answers: Record<string, string> = {};
    for (let i = 0; i < 8; i++) answers[`q${i}`] = `ans${i}`;
    answers.q8 = 'wrong';
    answers.q9 = 'wrong';
    const r = gradeAttempt(qs, answers);
    expect(r.correctCount).toBe(8);
    expect(r.score).toBe(80);
    expect(r.passed).toBe(true);
  });

  it('fails below the 70% threshold: 6/10 -> 60, fail', () => {
    const qs = Array.from({ length: 10 }, (_, i) => mc(`q${i}`, `ans${i}`));
    const answers: Record<string, string> = {};
    for (let i = 0; i < 6; i++) answers[`q${i}`] = `ans${i}`;
    const r = gradeAttempt(qs, answers);
    expect(r.score).toBe(60);
    expect(r.passed).toBe(false);
  });

  it('passes exactly at 70%', () => {
    const qs = Array.from({ length: 10 }, (_, i) => mc(`q${i}`, `ans${i}`));
    const answers: Record<string, string> = {};
    for (let i = 0; i < 7; i++) answers[`q${i}`] = `ans${i}`;
    expect(gradeAttempt(qs, answers).passed).toBe(true);
  });

  it('normalizes short answers (case, whitespace, curly quotes)', () => {
    expect(isCorrect(sa('q', 'A scalar'), 'a  scalar ')).toBe(true);
    expect(isCorrect(sa('q', "tina.pencolor('blue')"), 'tina.pencolor(‘blue’)')).toBe(true);
    expect(isCorrect(sa('q', 'print("Hello World!")'), 'print(“Hello World!”)')).toBe(true);
    expect(isCorrect(sa('q', 'scalar'), 'vector')).toBe(false);
  });

  it('multiple choice is exact (case-sensitive), not normalized', () => {
    expect(isCorrect(mc('q', 'Blue'), 'blue')).toBe(false);
    expect(isCorrect(mc('q', 'Blue'), 'Blue')).toBe(true);
  });

  it('blank answers are incorrect; empty quiz scores 0', () => {
    expect(gradeAttempt([], {}).score).toBe(0);
    const r = gradeAttempt([mc('q', 'a')], {});
    expect(r.correctCount).toBe(0);
    expect(r.passed).toBe(false);
  });

  it('normalizeAnswer collapses whitespace and lowercases', () => {
    expect(normalizeAnswer('  Hello   World ')).toBe('hello world');
  });

  it('result rows carry the correct answer and explanation for feedback', () => {
    const r = gradeAttempt([mc('q0', 'right')], { q0: 'wrong' });
    expect(r.results[0]).toMatchObject({
      questionId: 'q0',
      correct: false,
      studentAnswer: 'wrong',
      correctAnswer: 'right',
      explanation: 'because',
    });
  });
});
