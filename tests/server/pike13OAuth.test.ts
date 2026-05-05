import request from 'supertest';
import express from 'express';
import session from 'express-session';
import * as schema from '../../server/src/db/schema';
import { adminRouter } from '../../server/src/routes/admin';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import type { SessionUser } from '../../server/src/types/session';
import { db } from '../../server/src/db';

const ADMIN: SessionUser = {
  id: 0,
  name: 'Test Admin',
  email: 'admin@test.local',
  isAdmin: true,
  isActiveInstructor: false,
};

const NON_ADMIN: SessionUser = {
  id: 1,
  name: 'Instructor',
  email: 'instr@test.local',
  isAdmin: false,
  isActiveInstructor: true,
  instructorId: 1,
};

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

beforeAll(async () => {
  // Ensure Pike13 env vars are set for tests
  process.env.PIKE13_CLIENT_ID = 'test-client-id';
  process.env.PIKE13_CLIENT_SECRET = 'test-client-secret';
  process.env.PIKE13_CALLBACK_URL = 'http://localhost:3000/api/admin/pike13/callback';

  await db.delete(schema.pike13AdminToken);
});

afterAll(async () => {
  await db.delete(schema.pike13AdminToken);
});

afterEach(async () => {
  jest.restoreAllMocks();
});

// Helper: log in as a given user and return agent
async function loginAs(app: express.Express, user: SessionUser) {
  const agent = request.agent(app);
  await agent.post('/test/login').send(user);
  return agent;
}

describe('GET /api/admin/pike13/connect', () => {
  it('returns 302 to Pike13 authorize URL for admin', async () => {
    const app = buildTestApp();
    const agent = await loginAs(app, ADMIN);
    const res = await agent.get('/api/admin/pike13/connect').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('pike13.com/oauth/authorize');
    expect(res.headers.location).toContain('test-client-id');
  });

  it('returns 401 for unauthenticated request', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/api/admin/pike13/connect');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const app = buildTestApp();
    const agent = await loginAs(app, NON_ADMIN);
    const res = await agent.get('/api/admin/pike13/connect');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/pike13/callback', () => {
  it('stores token and redirects to /admin', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'acc-tok',
        refresh_token: 'ref-tok',
        expires_in: 3600,
      }),
    } as Response);

    const app = buildTestApp();
    const agent = await loginAs(app, ADMIN);
    const res = await agent.get('/api/admin/pike13/callback?code=authcode123').redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin');

    const rows = await db.select().from(schema.pike13AdminToken);
    expect(rows).toHaveLength(1);
    expect(rows[0].accessToken).toBe('acc-tok');
    expect(rows[0].refreshToken).toBe('ref-tok');
    expect(rows[0].expiresAt).toBeInstanceOf(Date);
  });

  it('replaces existing token row when called twice (idempotent)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-tok' }),
    } as Response);

    const app = buildTestApp();
    const agent = await loginAs(app, ADMIN);
    await agent.get('/api/admin/pike13/callback?code=code1').redirects(0);
    await agent.get('/api/admin/pike13/callback?code=code2').redirects(0);

    const rows = await db.select().from(schema.pike13AdminToken);
    expect(rows).toHaveLength(1);
    expect(rows[0].accessToken).toBe('new-tok');
  });

  it('returns 400 when code param is missing', async () => {
    const app = buildTestApp();
    const agent = await loginAs(app, ADMIN);
    const res = await agent.get('/api/admin/pike13/callback');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/pike13/status', () => {
  it('returns { connected: false } when no token exists', async () => {
    await db.delete(schema.pike13AdminToken);
    const app = buildTestApp();
    const agent = await loginAs(app, ADMIN);
    const res = await agent.get('/api/admin/pike13/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  it('returns { connected: true } when token exists', async () => {
    await db.delete(schema.pike13AdminToken);
    await db.insert(schema.pike13AdminToken).values({ accessToken: 'tok' });
    const app = buildTestApp();
    const agent = await loginAs(app, ADMIN);
    const res = await agent.get('/api/admin/pike13/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true });
  });
});
