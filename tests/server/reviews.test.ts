import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { reviewsRouter } from '../../server/src/routes/reviews';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import type { SessionUser } from '../../server/src/types/session';
import { db } from '../../server/src/db';
let instructorId: number;
let altInstructorId: number;
let studentId: number;
let altStudentId: number;
let reviewId: number;

// Build a minimal Express app with reviewsRouter and a controllable test-login route
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({ secret: 'test', resave: false, saveUninitialized: false }),
  );
  // Test-only login: sets session.user from POST body
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
function adminUser(): SessionUser {
  return { id: 0, name: 'Admin', email: 'a@t', isAdmin: true, isActiveInstructor: false };
}

beforeAll(async () => {
  // Seed primary instructor + student + review
  const [user] = await db
    .insert(schema.users)
    .values({ email: 'rev-instr@test.local', name: 'Review Instructor' })
    .returning();
  const [instr] = await db
    .insert(schema.instructors)
    .values({ userId: user.id, isActive: true })
    .returning();
  instructorId = instr.id;

  const [student] = await db
    .insert(schema.students)
    .values({ name: 'Review Student' })
    .returning();
  studentId = student.id;

  const [review] = await db
    .insert(schema.monthlyReviews)
    .values({ instructorId, studentId, month: '2025-11' })
    .returning();
  reviewId = review.id;

  // Seed alternate instructor for isolation tests
  const [altUser] = await db
    .insert(schema.users)
    .values({ email: 'rev-instr-alt@test.local', name: 'Alt Instructor' })
    .returning();
  const [altInstr] = await db
    .insert(schema.instructors)
    .values({ userId: altUser.id, isActive: true })
    .returning();
  altInstructorId = altInstr.id;

  const [altStudent] = await db
    .insert(schema.students)
    .values({ name: 'Alt Review Student' })
    .returning();
  altStudentId = altStudent.id;
});

afterAll(async () => {
  await db.delete(schema.monthlyReviews).where(eq(schema.monthlyReviews.instructorId, instructorId));
  await db.delete(schema.monthlyReviews).where(eq(schema.monthlyReviews.instructorId, altInstructorId));
  await db.delete(schema.instructors).where(eq(schema.instructors.id, instructorId));
  await db.delete(schema.instructors).where(eq(schema.instructors.id, altInstructorId));
  await db.delete(schema.students).where(eq(schema.students.id, studentId));
  await db.delete(schema.students).where(eq(schema.students.id, altStudentId));
  await db.delete(schema.users).where(eq(schema.users.email, 'rev-instr@test.local'));
  await db.delete(schema.users).where(eq(schema.users.email, 'rev-instr-alt@test.local'));
});

// ── Auth guard tests ──────────────────────────────────────────────────────────
// These use the main app (imported via index) to test isActiveInstructor.
import app from '../../server/src/index';

describe('Reviews API auth guards', () => {
  it('GET /api/reviews returns 401 without session', async () => {
    expect((await request(app).get('/api/reviews')).status).toBe(401);
  });
  it('GET /api/reviews returns 403 for admin', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ role: 'admin' });
    expect((await agent.get('/api/reviews')).status).toBe(403);
  });
  it('GET /api/reviews returns 403 for inactive', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ role: 'inactive' });
    expect((await agent.get('/api/reviews')).status).toBe(403);
  });
  it('POST /api/reviews returns 401 without session', async () => {
    expect((await request(app).post('/api/reviews').send({ studentId: 1, month: '2026-01' })).status).toBe(401);
  });
  it('GET /api/reviews/:id returns 401 without session', async () => {
    expect((await request(app).get('/api/reviews/1')).status).toBe(401);
  });
  it('PUT /api/reviews/:id returns 401 without session', async () => {
    expect((await request(app).put('/api/reviews/1').send({ subject: 'x' })).status).toBe(401);
  });
  it('POST /api/reviews/:id/send returns 401 without session', async () => {
    expect((await request(app).post('/api/reviews/1/send')).status).toBe(401);
  });
});

// ── CRUD happy-path tests ─────────────────────────────────────────────────────

describe('Reviews API CRUD', () => {
  let testApp: ReturnType<typeof buildTestApp>;
  let createdReviewId: number;

  beforeAll(() => {
    testApp = buildTestApp();
  });

  async function asInstructor() {
    const agent = request.agent(testApp);
    await agent.post('/test/login').send(instrUser(instructorId));
    return agent;
  }

  it('GET /api/reviews returns empty array for a month with no reviews', async () => {
    const agent = await asInstructor();
    const res = await agent.get('/api/reviews?month=2020-01');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('POST /api/reviews creates a pending review', async () => {
    const agent = await asInstructor();
    const res = await agent.post('/api/reviews').send({ studentId, month: '2026-03' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      studentId,
      month: '2026-03',
      status: 'pending',
      subject: null,
      body: null,
      sentAt: null,
    });
    createdReviewId = res.body.id;
  });

  it('POST /api/reviews is idempotent (returns 200 on duplicate)', async () => {
    const agent = await asInstructor();
    const res = await agent.post('/api/reviews').send({ studentId, month: '2026-03' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdReviewId);
  });

  it('GET /api/reviews/:id returns the review', async () => {
    const agent = await asInstructor();
    const res = await agent.get(`/api/reviews/${createdReviewId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdReviewId);
  });

  it('GET /api/reviews lists reviews for the month', async () => {
    const agent = await asInstructor();
    const res = await agent.get('/api/reviews?month=2026-03');
    expect(res.status).toBe(200);
    expect(res.body.some((r: { id: number }) => r.id === createdReviewId)).toBe(true);
  });

  it('PUT /api/reviews/:id updates fields and sets status to draft', async () => {
    const agent = await asInstructor();
    const res = await agent
      .put(`/api/reviews/${createdReviewId}`)
      .send({ subject: 'Great work', body: 'Keep it up!' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'draft', subject: 'Great work', body: 'Keep it up!' });
  });

  it('POST /api/reviews/:id/send sets status to sent and records sentAt', async () => {
    const agent = await asInstructor();
    const res = await agent.post(`/api/reviews/${createdReviewId}/send`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sent');
    expect(res.body.sentAt).not.toBeNull();
  });

  it('PUT /api/reviews/:id returns 409 when status is sent', async () => {
    const agent = await asInstructor();
    const res = await agent.put(`/api/reviews/${createdReviewId}`).send({ subject: 'Changed' });
    expect(res.status).toBe(409);
  });

  it('POST /api/reviews/:id/send is idempotent when already sent', async () => {
    const agent = await asInstructor();
    const res = await agent.post(`/api/reviews/${createdReviewId}/send`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sent');
  });

  it('GET /api/reviews/:id returns 404 for another instructor\'s review', async () => {
    // altInstructor tries to access reviewId which belongs to instructorId
    const altAgent = request.agent(testApp);
    await altAgent.post('/test/login').send(instrUser(altInstructorId));
    const res = await altAgent.get(`/api/reviews/${reviewId}`);
    expect(res.status).toBe(404);
  });

  it('cannot access reviews belonging to a different instructor', async () => {
    const altAgent = request.agent(testApp);
    await altAgent.post('/test/login').send(instrUser(altInstructorId));
    const res = await altAgent.get(`/api/reviews/${createdReviewId}`);
    expect(res.status).toBe(404);
  });
});
