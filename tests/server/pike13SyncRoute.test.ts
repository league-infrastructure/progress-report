import request from 'supertest';
import express from 'express';
import session from 'express-session';
import * as schema from '../../server/src/db/schema';
import { adminRouter } from '../../server/src/routes/admin';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import type { SessionUser } from '../../server/src/types/session';

// Mock the sync service so no real Pike13 calls are made. The route delegates
// token resolution + sync to syncWithStoredToken.
jest.mock('../../server/src/services/pike13Sync');
import { syncWithStoredToken } from '../../server/src/services/pike13Sync';
const mockSync = syncWithStoredToken as jest.MockedFunction<typeof syncWithStoredToken>;

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

async function loginAs(app: express.Express, user: SessionUser) {
  const agent = request.agent(app);
  await agent.post('/test/login').send(user);
  return agent;
}

beforeAll(async () => {
  await db.delete(schema.pike13AdminToken);
});

afterAll(async () => {
  await db.delete(schema.pike13AdminToken);
});

afterEach(async () => {
  await db.delete(schema.pike13AdminToken);
  jest.resetAllMocks();
});

describe('POST /api/admin/sync/pike13 — auth', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(buildTestApp()).post('/api/admin/sync/pike13');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const agent = await loginAs(buildTestApp(), NON_ADMIN);
    const res = await agent.post('/api/admin/sync/pike13');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/sync/pike13 — no token', () => {
  it('returns 409 when Pike13 is not connected', async () => {
    mockSync.mockResolvedValueOnce({ ok: false, reason: 'not_connected' });
    const agent = await loginAs(buildTestApp(), ADMIN);
    const res = await agent.post('/api/admin/sync/pike13');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Pike13 not connected' });
  });

  it('returns 401 when the token refresh fails', async () => {
    mockSync.mockResolvedValueOnce({ ok: false, reason: 'refresh_failed' });
    const agent = await loginAs(buildTestApp(), ADMIN);
    const res = await agent.post('/api/admin/sync/pike13');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Pike13 token refresh failed' });
  });
});

describe('POST /api/admin/sync/pike13 — sync', () => {
  it('returns 200 with SyncResult on success', async () => {
    mockSync.mockResolvedValueOnce({
      ok: true,
      result: { studentsUpserted: 10, instructorsUpserted: 0, assignmentsCreated: 5, hoursCreated: 3 },
    });

    const agent = await loginAs(buildTestApp(), ADMIN);
    const res = await agent.post('/api/admin/sync/pike13');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ studentsUpserted: 10, instructorsUpserted: 0, assignmentsCreated: 5, hoursCreated: 3 });
    expect(mockSync).toHaveBeenCalled();
  });
});
