import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { quizRouter } from '../../server/src/routes/quiz';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import type { QuizSessionUser } from '../../server/src/types/session';
import { db } from '../../server/src/db';

// Best-effort email send is mocked so no real SendGrid call happens; we assert it
// is invoked with the right recipient.
const sendParentQuizNote = jest.fn(async (_arg: { parentEmail: string; note: string }) => true);
jest.mock('../../server/src/services/email', () => ({
  __esModule: true,
  sendPlacementResultEmail: jest.fn(async () => false),
  sendParentQuizNote: (arg: { parentEmail: string; note: string }) => sendParentQuizNote(arg),
}));

let instructorId: number;
let altInstructorId: number;
let studentWithEmail: number;
let studentNoEmail: number;
let lessonId: number;
let quizWithEmail: number;
let quizNoEmail: number;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.post('/test/login', (req: express.Request, res: express.Response) => {
    req.session.quizUser = req.body as QuizSessionUser;
    res.json({ ok: true });
  });
  app.use('/api/quiz', quizRouter);
  app.use(errorHandler);
  return app;
}

const instr = (id: number): QuizSessionUser => ({ role: 'instructor', instructorId: id });

beforeAll(async () => {
  const [u1] = await db.insert(schema.users).values({ email: 'pn-instr@test.local', name: 'PN Instr' }).returning();
  const [i1] = await db.insert(schema.instructors).values({ userId: u1.id, isActive: true }).returning();
  instructorId = i1.id;
  const [u2] = await db.insert(schema.users).values({ email: 'pn-instr2@test.local', name: 'PN Instr2' }).returning();
  const [i2] = await db.insert(schema.instructors).values({ userId: u2.id, isActive: true }).returning();
  altInstructorId = i2.id;

  const [s1] = await db.insert(schema.students).values({ name: 'Has Email', guardianEmail: 'parent@home.test' }).returning();
  studentWithEmail = s1.id;
  const [s2] = await db.insert(schema.students).values({ name: 'No Email' }).returning();
  studentNoEmail = s2.id;

  const [lvl] = await db.insert(schema.quizLevels).values({ slug: 'pn-lvl', name: 'PN Level', order: 1 }).returning();
  const [lesson] = await db
    .insert(schema.quizLessons)
    .values({ levelId: lvl.id, name: 'PN Lesson', module: 'mod', path: 'pn/lesson', order: 1 })
    .returning();
  lessonId = lesson.id;

  const [q1] = await db.insert(schema.quizQuestions).values({
    id: 'pnq1', lessonId, type: 'multiple_choice', category: 'c', question: '1+1?', code: null,
    options: ['1', '2'], answer: '2', explanation: 'two',
  }).returning();

  const [quizA] = await db.insert(schema.quizzes).values({
    studentId: studentWithEmail, instructorId, lessonId, status: 'completed', questionIds: [q1.id],
  }).returning();
  quizWithEmail = quizA.id;
  await db.insert(schema.quizAttempts).values({
    quizId: quizWithEmail, studentId: studentWithEmail, answers: { pnq1: '2' }, score: 100, passed: true,
  });

  const [quizB] = await db.insert(schema.quizzes).values({
    studentId: studentNoEmail, instructorId, lessonId, status: 'completed', questionIds: [q1.id],
  }).returning();
  quizNoEmail = quizB.id;
  await db.insert(schema.quizAttempts).values({
    quizId: quizNoEmail, studentId: studentNoEmail, answers: { pnq1: '1' }, score: 0, passed: false,
  });
});

beforeEach(() => sendParentQuizNote.mockClear());

describe('instructor parent-note review', () => {
  it('GET /review returns score, results with correct answers, parent email, and note state', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(instr(instructorId));

    const res = await agent.get(`/api/quiz/instructor/quizzes/${quizWithEmail}/review`);
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(100);
    expect(res.body.parentEmail).toBe('parent@home.test');
    expect(res.body.results[0]).toMatchObject({ questionId: 'pnq1', correct: true, correctAnswer: '2' });
    expect(res.body.parentNoteSentAt).toBeNull();
  });

  it('forbids reviewing a quiz owned by another instructor', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(instr(altInstructorId));

    const res = await agent.get(`/api/quiz/instructor/quizzes/${quizWithEmail}/review`);
    expect(res.status).toBe(403);
  });

  it('POST /send-parent-note sends, persists the note, and stamps a timestamp', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(instr(instructorId));

    const res = await agent
      .post(`/api/quiz/instructor/quizzes/${quizWithEmail}/send-parent-note`)
      .send({ note: 'Great work this week!' });
    expect(res.status).toBe(200);
    expect(res.body.emailed).toBe(true);
    expect(res.body.parentNoteSentAt).toBeTruthy();
    expect(sendParentQuizNote).toHaveBeenCalledTimes(1);
    expect(sendParentQuizNote).toHaveBeenCalledWith(
      expect.objectContaining({ parentEmail: 'parent@home.test', note: 'Great work this week!' }),
    );

    const row = db.select().from(schema.quizzes).where(eq(schema.quizzes.id, quizWithEmail)).get();
    expect(row?.parentNote).toBe('Great work this week!');
    expect(row?.parentNoteSentAt).toBeTruthy();
  });

  it('allows re-sending and updates the timestamp', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(instr(instructorId));

    const first = db.select().from(schema.quizzes).where(eq(schema.quizzes.id, quizWithEmail)).get();
    await new Promise((r) => setTimeout(r, 5));
    const res = await agent
      .post(`/api/quiz/instructor/quizzes/${quizWithEmail}/send-parent-note`)
      .send({ note: 'Edited note.' });
    expect(res.status).toBe(200);
    expect(sendParentQuizNote).toHaveBeenCalledTimes(1);

    const after = db.select().from(schema.quizzes).where(eq(schema.quizzes.id, quizWithEmail)).get();
    expect(after?.parentNote).toBe('Edited note.');
    expect(after!.parentNoteSentAt!.getTime()).toBeGreaterThanOrEqual(first!.parentNoteSentAt?.getTime() ?? 0);
  });

  it('returns 400 when the student has no parent email on file', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(instr(instructorId));

    const res = await agent
      .post(`/api/quiz/instructor/quizzes/${quizNoEmail}/send-parent-note`)
      .send({ note: 'hi' });
    expect(res.status).toBe(400);
    expect(sendParentQuizNote).not.toHaveBeenCalled();
  });
});
