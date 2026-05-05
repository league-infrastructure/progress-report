import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { volunteerHoursRouter } from '../../server/src/routes/volunteer-hours';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import type { SessionUser } from '../../server/src/types/session';
import { db } from '../../server/src/db';

function buildTestApp() {
  const a = express();
  a.use(express.json());
  a.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  a.post('/test/login', (req: express.Request, res: express.Response) => {
    req.session.user = req.body as SessionUser;
    res.json({ ok: true });
  });
  a.use('/api', volunteerHoursRouter);
  a.use(errorHandler);
  return a;
}

const ADMIN: SessionUser = { id: 0, name: 'Test Admin', email: 'admin@test.local', isAdmin: true, isActiveInstructor: false };
const INSTRUCTOR: SessionUser = { id: 1, name: 'Test Instructor', email: 'instr@test.local', isAdmin: false, isActiveInstructor: true, instructorId: 1 };

beforeAll(async () => {
  // Clean up any leftover volunteer hours from prior runs
  await db.delete(schema.volunteerHours);
});

afterAll(async () => {
  await db.delete(schema.volunteerHours);
});

// ---- Auth guards ----

describe('Volunteer Hours API auth guards', () => {
  it('GET /api/admin/volunteer-hours returns 401 without session', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/api/admin/volunteer-hours');
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/volunteer-hours returns 403 for non-admin', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(INSTRUCTOR);
    const res = await agent.get('/api/admin/volunteer-hours');
    expect(res.status).toBe(403);
  });

  it('POST /api/admin/volunteer-hours returns 401 without session', async () => {
    const app = buildTestApp();
    const res = await request(app).post('/api/admin/volunteer-hours').send({ volunteerName: 'X', category: 'Y', hours: 1 });
    expect(res.status).toBe(401);
  });
});

// ---- CRUD happy paths ----

describe('POST /api/admin/volunteer-hours', () => {
  it('creates a new entry and returns 201', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.post('/api/admin/volunteer-hours').send({
      volunteerName: 'Alice',
      category: 'Teaching',
      hours: 2.5,
      description: 'Helped with lab',
    });
    expect(res.status).toBe(201);
    expect(res.body.volunteerName).toBe('Alice');
    expect(res.body.category).toBe('Teaching');
    expect(res.body.hours).toBeCloseTo(2.5);
    expect(res.body.source).toBe('manual');
  });

  it('returns 400 when volunteerName is missing', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.post('/api/admin/volunteer-hours').send({ category: 'Teaching', hours: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when category is missing', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.post('/api/admin/volunteer-hours').send({ volunteerName: 'Alice', hours: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when hours is missing', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.post('/api/admin/volunteer-hours').send({ volunteerName: 'Alice', category: 'Teaching' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/volunteer-hours', () => {
  let createdId: number;

  beforeAll(async () => {
    // Volunteer hours are filtered by TA/VA name prefix, so use a matching name.
    const [row] = await db
      .insert(schema.volunteerHours)
      .values({ volunteerName: 'TA Bob', category: 'Events', hours: 3.0 })
      .returning();
    createdId = row.id;
  });

  afterAll(async () => {
    await db.delete(schema.volunteerHours).where(eq(schema.volunteerHours.id, createdId));
  });

  it('lists all entries for admin', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/volunteer-hours');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const entry = res.body.find((r: { id: number }) => r.id === createdId);
    expect(entry).toBeDefined();
    expect(entry.volunteerName).toBe('TA Bob');
  });

  it('filters by category', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.get('/api/admin/volunteer-hours?category=Events');
    expect(res.status).toBe(200);
    const allMatch = (res.body as Array<{ category: string }>).every((r) => r.category === 'Events');
    expect(allMatch).toBe(true);
  });
});

describe('PUT /api/admin/volunteer-hours/:id', () => {
  let entryId: number;

  beforeAll(async () => {
    const [row] = await db
      .insert(schema.volunteerHours)
      .values({ volunteerName: 'Carol', category: 'Mentoring', hours: 1.0 })
      .returning();
    entryId = row.id;
  });

  afterAll(async () => {
    await db.delete(schema.volunteerHours).where(eq(schema.volunteerHours.id, entryId));
  });

  it('updates fields and returns updated entry', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.put(`/api/admin/volunteer-hours/${entryId}`).send({ hours: 2.0, description: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.hours).toBeCloseTo(2.0);
    expect(res.body.description).toBe('Updated');
  });

  it('returns 404 for unknown id', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.put('/api/admin/volunteer-hours/99999').send({ hours: 1 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/volunteer-hours/:id', () => {
  it('deletes a manual entry', async () => {
    const [row] = await db
      .insert(schema.volunteerHours)
      .values({ volunteerName: 'Dave', category: 'Admin', hours: 0.5 })
      .returning();

    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.delete(`/api/admin/volunteer-hours/${row.id}`);
    expect(res.status).toBe(204);
  });

  it('returns 403 for a pike13-sourced entry', async () => {
    const [row] = await db
      .insert(schema.volunteerHours)
      .values({ volunteerName: 'Eve', category: 'Teaching', hours: 1.0, source: 'pike13' })
      .returning();

    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.delete(`/api/admin/volunteer-hours/${row.id}`);
    expect(res.status).toBe(403);

    // Clean up
    await db.delete(schema.volunteerHours).where(eq(schema.volunteerHours.id, row.id));
  });

  it('returns 404 for unknown id', async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(ADMIN);
    const res = await agent.delete('/api/admin/volunteer-hours/99999');
    expect(res.status).toBe(404);
  });
});
