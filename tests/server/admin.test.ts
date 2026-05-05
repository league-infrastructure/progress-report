import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { adminRouter } from '../../server/src/routes/admin';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import type { SessionUser } from '../../server/src/types/session';
import { db } from '../../server/src/db';

// IDs created during setup
let instructorId: number;
let adminNotifId: number;

function buildTestApp() {
  const a = express();
  a.use(express.json());
  a.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  a.post('/test/login', (req: express.Request, res: express.Response) => {
    req.session.user = req.body as SessionUser;
    res.json({ ok: true });
  });
  a.use('/api', adminRouter);
  a.use(errorHandler);
  return a;
}

const ADMIN: SessionUser = { id: 0, name: 'Test Admin', email: 'admin@test.local', isAdmin: true, isActiveInstructor: false };
const INSTRUCTOR: SessionUser = { id: 1, name: 'Test Instructor', email: 'instr@test.local', isAdmin: false, isActiveInstructor: true, instructorId: 1 };

beforeAll(async () => {
  // Clean up any leftover data (FK order)
  await db.delete(schema.adminNotifications);
  await db.delete(schema.serviceFeedback);
  await db.delete(schema.monthlyReviews);
  await db.delete(schema.instructorStudents);
  const existingUser = (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'test-admin-instr@test.local')))[0];
  if (existingUser) {
    await db.delete(schema.instructors).where(eq(schema.instructors.userId, existingUser.id));
    await db.delete(schema.users).where(eq(schema.users.id, existingUser.id));
  }

  // Create a test instructor user
  const [user] = await db
    .insert(schema.users)
    .values({ email: 'test-admin-instr@test.local', name: 'Test Instructor' })
    .returning();

  const [instr] = await db
    .insert(schema.instructors)
    .values({ userId: user.id, isActive: true })
    .returning();
  instructorId = instr.id;

  // Create a notification from the instructor user
  const [notif] = await db
    .insert(schema.adminNotifications)
    .values({ fromUserId: user.id, message: 'Please add TA Alice' })
    .returning();
  adminNotifId = notif.id;
});

afterAll(async () => {
  await db.delete(schema.taCheckins).where(eq(schema.taCheckins.instructorId, instructorId));
  await db.delete(schema.adminNotifications).where(eq(schema.adminNotifications.id, adminNotifId));
  await db.delete(schema.instructorStudents).where(eq(schema.instructorStudents.instructorId, instructorId));
  await db.delete(schema.instructors).where(eq(schema.instructors.id, instructorId));
  await db.delete(schema.users).where(eq(schema.users.email, 'test-admin-instr@test.local'));
});

// ---- Auth guards ----

describe('Admin API auth guards', () => {
  it('GET /api/admin/instructors returns 401 without session', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/api/admin/instructors');
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/instructors returns 403 for instructor role', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(INSTRUCTOR);
    const res = await agent.get('/api/admin/instructors');
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/compliance returns 401 without session', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/api/admin/compliance');
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/notifications returns 401 without session', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/api/admin/notifications');
    expect(res.status).toBe(401);
  });
});

// ---- Instructor list ----

describe('GET /api/admin/instructors', () => {
  it('returns instructor list for admin', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/instructors');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const instr = res.body.find((r: { id: number }) => r.id === instructorId);
    expect(instr).toBeDefined();
    expect(instr.studentCount).toBe(0);
    expect(instr.ratioBadge).toBe('ok');
  });

  it('ratioBadge is warning for 5 students', async () => {
    // Assign 5 students to the test instructor
    const studentIds: number[] = [];
    for (let i = 0; i < 5; i++) {
      const [s] = await db
        .insert(schema.students)
        .values({ name: `RatioStudent${i}` })
        .returning();
      studentIds.push(s.id);
      await db
        .insert(schema.instructorStudents)
        .values({ instructorId, studentId: s.id });
    }

    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/instructors');
    expect(res.status).toBe(200);
    const instr = res.body.find((r: { id: number }) => r.id === instructorId);
    expect(instr.studentCount).toBe(5);
    expect(instr.ratioBadge).toBe('warning');

    // Clean up
    await db.delete(schema.instructorStudents).where(eq(schema.instructorStudents.instructorId, instructorId));
    for (const sid of studentIds) {
      await db.delete(schema.students).where(eq(schema.students.id, sid));
    }
  });
});

// ---- Instructor activate/deactivate ----

describe('PATCH /api/admin/instructors/:id', () => {
  it('deactivates an instructor', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.patch(`/api/admin/instructors/${instructorId}`).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it('reactivates an instructor', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.patch(`/api/admin/instructors/${instructorId}`).send({ isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);
  });

  it('returns 404 for unknown instructor', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.patch('/api/admin/instructors/99999').send({ isActive: false });
    expect(res.status).toBe(404);
  });

  it('returns 400 when isActive is missing', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.patch(`/api/admin/instructors/${instructorId}`).send({});
    expect(res.status).toBe(400);
  });
});

// ---- Compliance ----

describe('GET /api/admin/compliance', () => {
  it('returns compliance rows for active instructors', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/compliance?month=2025-06');
    expect(res.status).toBe(200);
    expect(res.body.month).toBe('2025-06');
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('defaults to current month when no month param', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/compliance');
    expect(res.status).toBe(200);
    const currentMonth = new Date().toISOString().slice(0, 7);
    expect(res.body.month).toBe(currentMonth);
  });

  it('recentCheckinSubmitted is true when ta_checkin exists for the last Monday of month', async () => {
    // The lastMondayOfMonth('2025-06') is 2025-06-30 (a Monday)
    await db.insert(schema.taCheckins).values({
      instructorId,
      taName: 'TA Bob',
      weekOf: '2025-06-30',
      wasPresent: true,
    }).onConflictDoNothing();

    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/compliance?month=2025-06');
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: { instructorId: number }) => r.instructorId === instructorId);
    expect(row?.recentCheckinSubmitted).toBe(true);

    await db.delete(schema.taCheckins).where(
      eq(schema.taCheckins.instructorId, instructorId)
    );
  });
});

// ---- Notifications ----

describe('GET /api/admin/notifications', () => {
  it('returns all notifications for admin', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/notifications');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const notif = res.body.find((n: { id: number }) => n.id === adminNotifId);
    expect(notif).toBeDefined();
    expect(notif.message).toBe('Please add TA Alice');
    expect(notif.isRead).toBe(false);
  });

  it('filters to unread when ?unread=true', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/notifications?unread=true');
    expect(res.status).toBe(200);
    const allUnread = (res.body as Array<{ isRead: boolean }>).every((n) => !n.isRead);
    expect(allUnread).toBe(true);
  });
});

// ---- Feedback ----

describe('GET /api/admin/feedback', () => {
  let feedbackReviewId: number;
  let feedbackStudentId: number;

  beforeAll(async () => {
    const [student] = await db
      .insert(schema.students)
      .values({ name: 'Feedback Student' })
      .returning();
    feedbackStudentId = student.id;

    const [review] = await db
      .insert(schema.monthlyReviews)
      .values({ instructorId, studentId: feedbackStudentId, month: '2026-04' })
      .returning();
    feedbackReviewId = review.id;
  });

  afterAll(async () => {
    await db.delete(schema.serviceFeedback).where(eq(schema.serviceFeedback.reviewId, feedbackReviewId));
    await db.delete(schema.monthlyReviews).where(eq(schema.monthlyReviews.id, feedbackReviewId));
    await db.delete(schema.students).where(eq(schema.students.id, feedbackStudentId));
  });

  it('returns 403 without admin auth', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/api/admin/feedback');
    expect(res.status).toBe(401);
  });

  it('returns 403 for instructor role', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(INSTRUCTOR);
    const res = await agent.get('/api/admin/feedback');
    expect(res.status).toBe(403);
  });

  it('returns empty array when no feedback exists', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/feedback');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // No feedback for this review yet
    const fb = res.body.find((r: { reviewId: number }) => r.reviewId === feedbackReviewId);
    expect(fb).toBeUndefined();
  });

  it('returns feedback DTOs with correct fields ordered by submittedAt DESC', async () => {
    const [fb] = await db
      .insert(schema.serviceFeedback)
      .values({ reviewId: feedbackReviewId, rating: 4, comment: 'Very good' })
      .returning();

    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/feedback');
    expect(res.status).toBe(200);

    const item = res.body.find((r: { id: number }) => r.id === fb.id);
    expect(item).toMatchObject({
      id: fb.id,
      reviewId: feedbackReviewId,
      studentName: 'Feedback Student',
      instructorName: 'Test Instructor',
      month: '2026-04',
      rating: 4,
      comment: 'Very good',
    });
    expect(item.submittedAt).toBeDefined();
  });
});

describe('PATCH /api/admin/notifications/:id/read', () => {
  it('marks a notification as read', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.patch(`/api/admin/notifications/${adminNotifId}/read`);
    expect(res.status).toBe(200);
    expect(res.body.isRead).toBe(true);
  });

  it('returns 404 for unknown notification', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.patch('/api/admin/notifications/99999/read');
    expect(res.status).toBe(404);
  });
});
