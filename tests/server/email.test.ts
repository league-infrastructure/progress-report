/**
 * Email integration tests for POST /api/reviews/:id/send.
 *
 * Mocks the email service so no real SendGrid calls are made.
 */
import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import type { SessionUser } from '../../server/src/types/session';
import { db } from '../../server/src/db';

// Mock the email service before importing the route (factory avoids running the real module)
jest.mock('../../server/src/services/email', () => ({
  sendReviewEmail: jest.fn(),
}));
import { sendReviewEmail } from '../../server/src/services/email';

const mockSendReviewEmail = sendReviewEmail as jest.MockedFunction<typeof sendReviewEmail>;

// Import the router after mocking so it picks up the mock
import { reviewsRouter } from '../../server/src/routes/reviews';
import { errorHandler } from '../../server/src/middleware/errorHandler';

let instructorId: number;
let studentWithEmailId: number;
let studentNoEmailId: number;

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.post('/test/login', (req: express.Request, res: express.Response) => {
    req.session.user = req.body as SessionUser;
    res.json({ ok: true });
  });
  app.use('/api', reviewsRouter);
  app.use(errorHandler);
  return app;
}

function instrUser(id: number): SessionUser {
  return { id: 0, name: 'Test', email: 't@t', isAdmin: false, isActiveInstructor: true, instructorId: id };
}

beforeAll(async () => {
  const [user] = await db
    .insert(schema.users)
    .values({ email: 'email-test-instr@test.local', name: 'Email Test Instructor' })
    .returning();
  const [instr] = await db
    .insert(schema.instructors)
    .values({ userId: user.id, isActive: true })
    .returning();
  instructorId = instr.id;

  const [s1] = await db
    .insert(schema.students)
    .values({ name: 'Student With Email', guardianEmail: 'guardian@test.local' })
    .returning();
  studentWithEmailId = s1.id;

  const [s2] = await db
    .insert(schema.students)
    .values({ name: 'Student No Email' })
    .returning();
  studentNoEmailId = s2.id;
});

afterAll(async () => {
  await db.delete(schema.monthlyReviews).where(eq(schema.monthlyReviews.instructorId, instructorId));
  await db.delete(schema.instructors).where(eq(schema.instructors.id, instructorId));
  await db.delete(schema.students).where(eq(schema.students.id, studentWithEmailId));
  await db.delete(schema.students).where(eq(schema.students.id, studentNoEmailId));
  await db.delete(schema.users).where(eq(schema.users.email, 'email-test-instr@test.local'));
});

beforeEach(() => {
  mockSendReviewEmail.mockReset();
  mockSendReviewEmail.mockResolvedValue(undefined);
});

describe('POST /api/reviews/:id/send — email behaviour', () => {
  let testApp: ReturnType<typeof buildTestApp>;

  beforeAll(() => {
    testApp = buildTestApp();
  });

  async function asInstructor() {
    const agent = request.agent(testApp);
    await agent.post('/test/login').send(instrUser(instructorId));
    return agent;
  }

  it('calls sendReviewEmail when guardianEmail is present', async () => {
    const agent = await asInstructor();

    // Create and draft a review for a student with an email address
    const createRes = await agent
      .post('/api/reviews')
      .send({ studentId: studentWithEmailId, month: '2026-05' });
    expect(createRes.status).toBe(201);
    const reviewId = createRes.body.id;

    await agent.put(`/api/reviews/${reviewId}`).send({ subject: 'Great', body: 'Well done!' });

    const sendRes = await agent.post(`/api/reviews/${reviewId}/send`);
    expect(sendRes.status).toBe(200);
    expect(sendRes.body.status).toBe('sent');

    // Give the fire-and-forget a tick to execute
    await new Promise((r) => setImmediate(r));

    expect(mockSendReviewEmail).toHaveBeenCalledTimes(1);
    expect(mockSendReviewEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: 'guardian@test.local',
        studentName: 'Student With Email',
        month: '2026-05',
        reviewBody: 'Well done!',
      }),
    );
  });

  it('skips sendReviewEmail when guardianEmail is null', async () => {
    const agent = await asInstructor();

    const createRes = await agent
      .post('/api/reviews')
      .send({ studentId: studentNoEmailId, month: '2026-05' });
    expect(createRes.status).toBe(201);
    const reviewId = createRes.body.id;

    const sendRes = await agent.post(`/api/reviews/${reviewId}/send`);
    expect(sendRes.status).toBe(200);
    expect(sendRes.body.status).toBe('sent');

    await new Promise((r) => setImmediate(r));

    expect(mockSendReviewEmail).not.toHaveBeenCalled();
  });

  it('returns success even when sendReviewEmail throws', async () => {
    mockSendReviewEmail.mockRejectedValue(new Error('SendGrid 503'));

    const agent = await asInstructor();

    const createRes = await agent
      .post('/api/reviews')
      .send({ studentId: studentWithEmailId, month: '2026-06' });
    expect(createRes.status).toBe(201);
    const reviewId = createRes.body.id;

    const sendRes = await agent.post(`/api/reviews/${reviewId}/send`);
    expect(sendRes.status).toBe(200);
    expect(sendRes.body.status).toBe('sent');

    // Error must not propagate to the response
    await new Promise((r) => setImmediate(r));
    expect(mockSendReviewEmail).toHaveBeenCalledTimes(1);
  });
});
