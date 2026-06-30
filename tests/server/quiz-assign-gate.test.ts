import request from 'supertest';
import express from 'express';
import session from 'express-session';
import * as schema from '../../server/src/db/schema';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import type { QuizSessionUser } from '../../server/src/types/session';
import { db } from '../../server/src/db';

// Control the completion gate's verdict per test.
const checkRecipeCompletion = jest.fn();
jest.mock('../../server/src/services/quiz/completion', () => ({
  __esModule: true,
  CANONICAL_ORG: 'league-curriculum',
  checkRecipeCompletion: (...args: unknown[]) => checkRecipeCompletion(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { quizRouter } from '../../server/src/routes/quiz';

let instructorId: number;
let studentId: number;
let lessonId: number;

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
  const [u] = await db.insert(schema.users).values({ email: 'gate-instr@test.local', name: 'Gate Instr' }).returning();
  const [i] = await db.insert(schema.instructors).values({ userId: u.id, isActive: true }).returning();
  instructorId = i.id;
  const [s] = await db.insert(schema.students).values({ name: 'Gate Student', githubUsername: 'gatestudent' }).returning();
  studentId = s.id;
  const [lvl] = await db.insert(schema.quizLevels).values({ slug: 'gate-lvl', name: 'Gate', repo: 'Python-Apprentice', order: 1 }).returning();
  const [lesson] = await db
    .insert(schema.quizLessons)
    .values({ levelId: lvl.id, name: 'Gate Lesson', module: 'm', path: 'lessons/30_Loops', order: 1 })
    .returning();
  lessonId = lesson.id;
  // Two questions so sampleQuestions returns a non-empty set.
  await db.insert(schema.quizQuestions).values([
    { id: 'gq1', lessonId, type: 'multiple_choice', category: 'c', question: 'q1', code: null, options: ['a', 'b'], answer: 'a', explanation: 'x' },
    { id: 'gq2', lessonId, type: 'multiple_choice', category: 'c', question: 'q2', code: null, options: ['a', 'b'], answer: 'b', explanation: 'x' },
  ]);
});

beforeEach(() => checkRecipeCompletion.mockReset());

describe('POST /instructor/assign — recipe completion gate', () => {
  it('blocks with 409 and lists incomplete recipes when not complete and no bypass', async () => {
    checkRecipeCompletion.mockResolvedValue({ complete: false, incomplete: ['40_Crazy_Tina.py', '150_Number_Guess.py'], checked: true });
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(instr(instructorId));

    const res = await agent.post('/api/quiz/instructor/assign').send({ studentId, lessonId });
    expect(res.status).toBe(409);
    expect(res.body.incomplete).toEqual(['40_Crazy_Tina.py', '150_Number_Guess.py']);
    expect(res.body.checked).toBe(true);
  });

  it('assigns despite incompletion when a bypassReason is given (gate skipped)', async () => {
    checkRecipeCompletion.mockResolvedValue({ complete: false, incomplete: ['x.py'], checked: true });
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(instr(instructorId));

    const res = await agent.post('/api/quiz/instructor/assign').send({ studentId, lessonId, bypassReason: 'instructor override' });
    expect(res.status).toBe(201);
    expect(res.body.quizId).toBeTruthy();
    // Gate is not even consulted when bypassing.
    expect(checkRecipeCompletion).not.toHaveBeenCalled();
  });

  it('assigns when recipes are complete', async () => {
    checkRecipeCompletion.mockResolvedValue({ complete: true, incomplete: [], checked: true });
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(instr(instructorId));

    const res = await agent.post('/api/quiz/instructor/assign').send({ studentId, lessonId });
    expect(res.status).toBe(201);
    expect(res.body.tokenPath).toMatch(/^\/quiz\/t\//);
    expect(checkRecipeCompletion).toHaveBeenCalledTimes(1);
  });

  it('blocks with 409 (checked:false) when completion could not be verified', async () => {
    checkRecipeCompletion.mockResolvedValue({ complete: false, incomplete: [], checked: false, reason: 'No repo found.' });
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(instr(instructorId));

    const res = await agent.post('/api/quiz/instructor/assign').send({ studentId, lessonId });
    expect(res.status).toBe(409);
    expect(res.body.checked).toBe(false);
    expect(res.body.error).toMatch(/No repo found/);
  });
});
