import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { adminRouter } from '../../server/src/routes/admin';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import type { SessionUser } from '../../server/src/types/session';
import { db } from '../../server/src/db';

const TEST_ADMIN_EMAIL = 'admin-users-test@test.local';
const TEST_OTHER_ADMIN_EMAIL = 'other-admin-users-test@test.local';

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

const ADMIN: SessionUser = {
  id: 0,
  name: 'Test Admin',
  email: TEST_ADMIN_EMAIL,
  isAdmin: true,
  isActiveInstructor: false,
};

beforeAll(async () => {
  // Clean up any leftover test rows
  await db.delete(schema.adminSettings).where(eq(schema.adminSettings.email, TEST_ADMIN_EMAIL));
  await db
    .delete(schema.adminSettings)
    .where(eq(schema.adminSettings.email, TEST_OTHER_ADMIN_EMAIL));
});

afterAll(async () => {
  await db.delete(schema.adminSettings).where(eq(schema.adminSettings.email, TEST_ADMIN_EMAIL));
  await db
    .delete(schema.adminSettings)
    .where(eq(schema.adminSettings.email, TEST_OTHER_ADMIN_EMAIL));
});

// ---- Auth guards ----

describe('GET /api/admin/users — auth', () => {
  it('returns 401 without a session', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });
});

// ---- GET /api/admin/users ----

describe('GET /api/admin/users', () => {
  beforeAll(async () => {
    await db.insert(schema.adminSettings).values({ email: TEST_ADMIN_EMAIL }).onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(schema.adminSettings)
      .where(eq(schema.adminSettings.email, TEST_ADMIN_EMAIL));
  });

  it('returns 200 with an array for authenticated admin', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('includes the seeded admin entry with email and createdAt', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);
    const entry = (res.body as Array<{ email: string; createdAt: string }>).find(
      (r) => r.email === TEST_ADMIN_EMAIL,
    );
    expect(entry).toBeDefined();
    expect(typeof entry!.createdAt).toBe('string');
    // Should parse as a valid ISO date
    expect(new Date(entry!.createdAt).toISOString()).toBe(entry!.createdAt);
  });
});

// ---- POST /api/admin/users ----

describe('POST /api/admin/users', () => {
  afterEach(async () => {
    await db
      .delete(schema.adminSettings)
      .where(eq(schema.adminSettings.email, TEST_OTHER_ADMIN_EMAIL));
  });

  it('returns 201 and creates a new admin entry (happy path)', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent
      .post('/api/admin/users')
      .send({ email: TEST_OTHER_ADMIN_EMAIL });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(TEST_OTHER_ADMIN_EMAIL);
    expect(typeof res.body.createdAt).toBe('string');
  });

  it('normalizes email to lowercase on insert', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent
      .post('/api/admin/users')
      .send({ email: TEST_OTHER_ADMIN_EMAIL.toUpperCase() });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(TEST_OTHER_ADMIN_EMAIL);
  });

  it('returns 409 when the email is already an admin', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    // First insertion
    await agent.post('/api/admin/users').send({ email: TEST_OTHER_ADMIN_EMAIL });
    // Duplicate attempt
    const res = await agent
      .post('/api/admin/users')
      .send({ email: TEST_OTHER_ADMIN_EMAIL });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already an admin/i);
  });

  it('returns 400 when email is missing from body', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.post('/api/admin/users').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when email is not a string', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.post('/api/admin/users').send({ email: 123 });
    expect(res.status).toBe(400);
  });
});

// ---- DELETE /api/admin/users/:email ----

describe('DELETE /api/admin/users/:email', () => {
  beforeEach(async () => {
    // Seed a target admin to delete in each test
    await db
      .insert(schema.adminSettings)
      .values({ email: TEST_OTHER_ADMIN_EMAIL })
      .onConflictDoNothing();
  });

  afterEach(async () => {
    await db
      .delete(schema.adminSettings)
      .where(eq(schema.adminSettings.email, TEST_OTHER_ADMIN_EMAIL));
  });

  it('returns 401 for unauthenticated request', async () => {
    const app = buildTestApp();
    const res = await request(app).delete(
      `/api/admin/users/${encodeURIComponent(TEST_OTHER_ADMIN_EMAIL)}`,
    );
    expect(res.status).toBe(401);
  });

  it('returns 200 and removes an existing admin (happy path)', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.delete(
      `/api/admin/users/${encodeURIComponent(TEST_OTHER_ADMIN_EMAIL)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify the row is gone
    const rows = await db
      .select()
      .from(schema.adminSettings)
      .where(eq(schema.adminSettings.email, TEST_OTHER_ADMIN_EMAIL));
    expect(rows).toHaveLength(0);
  });

  it('returns 409 when the admin tries to remove themselves', async () => {
    // Seed the current admin's email in adminSettings too
    await db
      .insert(schema.adminSettings)
      .values({ email: TEST_ADMIN_EMAIL })
      .onConflictDoNothing();

    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.delete(
      `/api/admin/users/${encodeURIComponent(TEST_ADMIN_EMAIL)}`,
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot remove your own/i);

    // Clean up
    await db
      .delete(schema.adminSettings)
      .where(eq(schema.adminSettings.email, TEST_ADMIN_EMAIL));
  });

  it('returns 404 when the admin email does not exist', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.delete(
      `/api/admin/users/${encodeURIComponent('nonexistent@test.local')}`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
