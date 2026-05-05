/**
 * Public feedback API tests — no auth required.
 */
import request from 'supertest';
import express from 'express';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { feedbackRouter } from '../../server/src/routes/feedback';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import { db } from '../../server/src/db';
let instructorId: number;
let studentId: number;
let reviewId: number;
let feedbackToken: string;

const UNKNOWN_TOKEN = '00000000-0000-0000-0000-000000000000';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', feedbackRouter);
  app.use(errorHandler);
  return app;
}

let testApp: ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  testApp = buildTestApp();

  const [user] = await db
    .insert(schema.users)
    .values({ email: 'fb-instr@test.local', name: 'FB Instructor' })
    .returning();
  const [instr] = await db
    .insert(schema.instructors)
    .values({ userId: user.id, isActive: true })
    .returning();
  instructorId = instr.id;

  const [student] = await db
    .insert(schema.students)
    .values({ name: 'FB Student', guardianEmail: 'fb-guardian@test.local' })
    .returning();
  studentId = student.id;

  const [review] = await db
    .insert(schema.monthlyReviews)
    .values({ instructorId, studentId, month: '2026-04' })
    .returning();
  reviewId = review.id;
  feedbackToken = review.feedbackToken;
});

afterAll(async () => {
  await db.delete(schema.adminNotifications);
  await db.delete(schema.serviceFeedback).where(eq(schema.serviceFeedback.reviewId, reviewId));
  await db.delete(schema.monthlyReviews).where(eq(schema.monthlyReviews.id, reviewId));
  await db.delete(schema.instructors).where(eq(schema.instructors.id, instructorId));
  await db.delete(schema.students).where(eq(schema.students.id, studentId));
  await db.delete(schema.users).where(eq(schema.users.email, 'fb-instr@test.local'));
});

// Clean up feedback rows between tests to keep each test independent
afterEach(async () => {
  await db.delete(schema.adminNotifications);
  await db.delete(schema.serviceFeedback).where(eq(schema.serviceFeedback.reviewId, reviewId));
});

describe('GET /api/feedback/:token', () => {
  it('returns 200 with alreadySubmitted=false for a valid token', async () => {
    const res = await request(testApp).get(`/api/feedback/${feedbackToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      studentName: 'FB Student',
      month: '2026-04',
      alreadySubmitted: false,
    });
  });

  it('returns 200 with alreadySubmitted=true when feedback exists', async () => {
    await db.insert(schema.serviceFeedback).values({ reviewId, rating: 5 });
    const res = await request(testApp).get(`/api/feedback/${feedbackToken}`);
    expect(res.status).toBe(200);
    expect(res.body.alreadySubmitted).toBe(true);
  });

  it('returns 404 for an unknown token', async () => {
    const res = await request(testApp).get(`/api/feedback/${UNKNOWN_TOKEN}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/feedback/:token', () => {
  it('creates feedback with rating only and returns 201', async () => {
    const res = await request(testApp)
      .post(`/api/feedback/${feedbackToken}`)
      .send({ rating: 3 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ reviewId, rating: 3, comment: null });
    expect(res.body.submittedAt).toBeDefined();
  });

  it('creates feedback with rating and comment', async () => {
    const res = await request(testApp)
      .post(`/api/feedback/${feedbackToken}`)
      .send({ rating: 4, comment: 'Good job!' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ rating: 4, comment: 'Good job!' });
  });

  it('returns 409 on duplicate submission', async () => {
    await request(testApp)
      .post(`/api/feedback/${feedbackToken}`)
      .send({ rating: 5 });
    const res = await request(testApp)
      .post(`/api/feedback/${feedbackToken}`)
      .send({ rating: 4 });
    expect(res.status).toBe(409);
  });

  it('returns 400 when rating is 0', async () => {
    const res = await request(testApp)
      .post(`/api/feedback/${feedbackToken}`)
      .send({ rating: 0 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when rating is 6', async () => {
    const res = await request(testApp)
      .post(`/api/feedback/${feedbackToken}`)
      .send({ rating: 6 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when rating is missing', async () => {
    const res = await request(testApp)
      .post(`/api/feedback/${feedbackToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when rating is not an integer', async () => {
    const res = await request(testApp)
      .post(`/api/feedback/${feedbackToken}`)
      .send({ rating: 3.5 });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown token', async () => {
    const res = await request(testApp)
      .post(`/api/feedback/${UNKNOWN_TOKEN}`)
      .send({ rating: 4 });
    expect(res.status).toBe(404);
  });

  it('creates an adminNotification on successful submission', async () => {
    await request(testApp)
      .post(`/api/feedback/${feedbackToken}`)
      .send({ rating: 4 });
    const notifications = await db
      .select()
      .from(schema.adminNotifications);
    expect(notifications.length).toBe(1);
    expect(notifications[0].message).toBe('New feedback from guardian of FB Student');
    expect(notifications[0].fromUserId).toBeNull();
    expect(notifications[0].isRead).toBe(false);
  });
});
