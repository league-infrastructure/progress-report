import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { instructorRouter } from '../../server/src/routes/instructor';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import type { SessionUser } from '../../server/src/types/session';
import { db } from '../../server/src/db';

let instructorId: number;
let otherInstructorId: number;
let studentId: number;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.post('/test/login', (req: express.Request, res: express.Response) => {
    req.session.user = req.body as SessionUser;
    res.json({ ok: true });
  });
  app.use('/api', instructorRouter);
  app.use(errorHandler);
  return app;
}

const instr = (id: number): SessionUser => ({ id: 0, name: 'Instr', email: 'i@t', isAdmin: false, isActiveInstructor: true, instructorId: id });

async function login(app: express.Express, id: number) {
  const agent = request.agent(app);
  await agent.post('/test/login').send(instr(id));
  return agent;
}

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY; // parent-note uses the fallback template

  const [u1] = await db.insert(schema.users).values({ email: 'notif-instr@test.local', name: 'Notif Instr' }).returning();
  const [i1] = await db.insert(schema.instructors).values({ userId: u1.id, isActive: true }).returning();
  instructorId = i1.id;

  const [u2] = await db.insert(schema.users).values({ email: 'notif-other@test.local', name: 'Other Instr' }).returning();
  const [i2] = await db.insert(schema.instructors).values({ userId: u2.id, isActive: true }).returning();
  otherInstructorId = i2.id;

  const [s] = await db.insert(schema.students).values({ name: 'Notif Student', guardianName: 'Parent P' }).returning();
  studentId = s.id;
});

afterEach(async () => {
  await db.delete(schema.instructorNotifications).where(eq(schema.instructorNotifications.studentId, studentId));
  await db.delete(schema.monthlyReviews).where(eq(schema.monthlyReviews.studentId, studentId));
});

afterAll(async () => {
  await db.delete(schema.students).where(eq(schema.students.id, studentId));
  await db.delete(schema.instructors).where(inArray(schema.instructors.id, [instructorId, otherInstructorId]));
  await db.delete(schema.users).where(inArray(schema.users.email, ['notif-instr@test.local', 'notif-other@test.local']));
});

async function seedNotification(instrId: number): Promise<number> {
  const [n] = await db.insert(schema.instructorNotifications).values({
    instructorId: instrId, kind: 'no_commit', studentId, weekOf: '2026-04-13',
    message: 'Notif Student did not push any code last week.',
  }).returning({ id: schema.instructorNotifications.id });
  return n.id;
}

describe('instructor notifications API', () => {
  it('lists only the calling instructor\'s unacknowledged notifications', async () => {
    await seedNotification(instructorId);
    await seedNotification(otherInstructorId);

    const agent = await login(buildApp(), instructorId);
    const res = await agent.get('/api/instructor/notifications');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].studentName).toBe('Notif Student');
  });

  it('acknowledges a notification so it drops off the list', async () => {
    const nid = await seedNotification(instructorId);
    const app = buildApp();
    const agent = await login(app, instructorId);

    const ack = await agent.post(`/api/instructor/notifications/${nid}/acknowledge`);
    expect(ack.status).toBe(200);

    const res = await agent.get('/api/instructor/notifications');
    expect(res.body).toEqual([]);
  });

  it('cannot acknowledge another instructor\'s notification', async () => {
    const nid = await seedNotification(otherInstructorId);
    const agent = await login(buildApp(), instructorId);
    const ack = await agent.post(`/api/instructor/notifications/${nid}/acknowledge`);
    expect(ack.status).toBe(404);
  });

  it('drafts a parent note and attaches it to a new draft review', async () => {
    const nid = await seedNotification(instructorId);
    const agent = await login(buildApp(), instructorId);

    const res = await agent.post(`/api/instructor/notifications/${nid}/parent-note`);
    expect(res.status).toBe(200);
    expect(res.body.reviewId).toBeGreaterThan(0);
    expect(res.body.body).toContain('Notif Student');
    expect(res.body.body).toContain('Parent P'); // guardian greeting

    const [review] = await db.select().from(schema.monthlyReviews)
      .where(eq(schema.monthlyReviews.id, res.body.reviewId));
    expect(review.status).toBe('draft');
    expect(review.month).toBe('2026-04'); // derived from weekOf
    expect(review.instructorId).toBe(instructorId);
  });
});
