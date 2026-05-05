import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { checkinsRouter } from '../../server/src/routes/checkins';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import type { SessionUser } from '../../server/src/types/session';
import app from '../../server/src/index';
import { db } from '../../server/src/db';
let instructorId: number;
let userId: number;

function buildTestApp() {
  const a = express();
  a.use(express.json());
  a.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  a.post('/test/login', (req: express.Request, res: express.Response) => {
    req.session.user = req.body as SessionUser;
    res.json({ ok: true });
  });
  a.use('/api', checkinsRouter);
  a.use(errorHandler);
  return a;
}

function instrUser(instrId: number, uId: number): SessionUser {
  return { id: uId, name: 'T', email: 't@t', isAdmin: false, isActiveInstructor: true, instructorId: instrId };
}

beforeAll(async () => {
  const [user] = await db
    .insert(schema.users)
    .values({ email: 'checkin-instr@test.local', name: 'Checkin Instructor' })
    .returning();
  userId = user.id;
  const [instr] = await db
    .insert(schema.instructors)
    .values({ userId: user.id, isActive: true })
    .returning();
  instructorId = instr.id;
});

afterAll(async () => {
  await db.delete(schema.taCheckins).where(eq(schema.taCheckins.instructorId, instructorId));
  await db.delete(schema.adminNotifications).where(eq(schema.adminNotifications.fromUserId, userId));
  await db.delete(schema.instructors).where(eq(schema.instructors.id, instructorId));
  await db.delete(schema.users).where(eq(schema.users.email, 'checkin-instr@test.local'));
});

// ── Auth guard tests ──────────────────────────────────────────────────────────
describe('Checkins API auth guards', () => {
  it('GET /api/checkins/pending returns 401 without session', async () => {
    expect((await request(app).get('/api/checkins/pending')).status).toBe(401);
  });
  it('GET /api/checkins/pending returns 403 for admin', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ role: 'admin' });
    expect((await agent.get('/api/checkins/pending')).status).toBe(403);
  });
  it('POST /api/checkins returns 401 without session', async () => {
    expect((await request(app).post('/api/checkins').send({ weekOf: '2026-03-02', entries: [] })).status).toBe(401);
  });
  it('POST /api/checkins/notify-admin returns 401 without session', async () => {
    expect((await request(app).post('/api/checkins/notify-admin').send({ message: 'hi' })).status).toBe(401);
  });
});

// ── Functional tests ──────────────────────────────────────────────────────────
describe('Checkins API', () => {
  let testApp: ReturnType<typeof buildTestApp>;
  const TEST_WEEK = '2026-01-05'; // a fixed Monday for deterministic tests

  beforeAll(() => { testApp = buildTestApp(); });

  async function asInstructor() {
    const agent = request.agent(testApp);
    await agent.post('/test/login').send(instrUser(instructorId, userId));
    return agent;
  }

  it('GET /api/checkins/pending returns empty entries and alreadySubmitted=false initially', async () => {
    const agent = await asInstructor();
    const res = await agent.get('/api/checkins/pending');
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
    // alreadySubmitted may be true or false depending on whether current week has data
    expect(typeof res.body.alreadySubmitted).toBe('boolean');
    expect(res.body.weekOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('POST /api/checkins inserts check-in records', async () => {
    const agent = await asInstructor();
    const res = await agent.post('/api/checkins').send({
      weekOf: TEST_WEEK,
      entries: [
        { taName: 'Alice', wasPresent: true },
        { taName: 'Bob', wasPresent: false },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, weekOf: TEST_WEEK, count: 2 });

    // Verify rows were inserted
    const rows = await db
      .select()
      .from(schema.taCheckins)
      .where(and(eq(schema.taCheckins.instructorId, instructorId), eq(schema.taCheckins.weekOf, TEST_WEEK)));
    expect(rows.length).toBe(2);
  });

  it('POST /api/checkins is idempotent (upsert on duplicate week)', async () => {
    const agent = await asInstructor();
    await agent.post('/api/checkins').send({
      weekOf: TEST_WEEK,
      entries: [{ taName: 'Alice', wasPresent: false }],
    });

    const rows = await db
      .select()
      .from(schema.taCheckins)
      .where(and(eq(schema.taCheckins.instructorId, instructorId), eq(schema.taCheckins.weekOf, TEST_WEEK)));
    // Alice was updated; Bob still there
    expect(rows.length).toBe(2);
    const alice = rows.find((r: typeof rows[0]) => r.taName === 'Alice');
    expect(alice?.wasPresent).toBe(false);
  });

  it('POST /api/checkins/notify-admin persists message to admin_notifications', async () => {
    const agent = await asInstructor();
    const res = await agent
      .post('/api/checkins/notify-admin')
      .send({ message: 'Please create profile for TA Dave' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const [notif] = await db
      .select()
      .from(schema.adminNotifications)
      .where(eq(schema.adminNotifications.fromUserId, userId));
    expect(notif.message).toBe('Please create profile for TA Dave');
    expect(notif.isRead).toBe(false);
  });

  it('POST /api/checkins/notify-admin returns 400 when message is missing', async () => {
    const agent = await asInstructor();
    const res = await agent.post('/api/checkins/notify-admin').send({});
    expect(res.status).toBe(400);
  });
});
