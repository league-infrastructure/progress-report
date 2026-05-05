import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { templatesRouter } from '../../server/src/routes/templates';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import type { SessionUser } from '../../server/src/types/session';
import app from '../../server/src/index';
import { db } from '../../server/src/db';
let instructorId: number;
let altInstructorId: number;

function buildTestApp() {
  const a = express();
  a.use(express.json());
  a.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  a.post('/test/login', (req: express.Request, res: express.Response) => {
    req.session.user = req.body as SessionUser;
    res.json({ ok: true });
  });
  a.use('/api', templatesRouter);
  a.use(errorHandler);
  return a;
}

function instrUser(id: number): SessionUser {
  return { id: 0, name: 'T', email: 't@t', isAdmin: false, isActiveInstructor: true, instructorId: id };
}

beforeAll(async () => {
  const [user] = await db
    .insert(schema.users)
    .values({ email: 'tmpl-instr@test.local', name: 'Template Instructor' })
    .returning();
  const [instr] = await db
    .insert(schema.instructors)
    .values({ userId: user.id, isActive: true })
    .returning();
  instructorId = instr.id;

  const [altUser] = await db
    .insert(schema.users)
    .values({ email: 'tmpl-instr-alt@test.local', name: 'Alt Instructor' })
    .returning();
  const [altInstr] = await db
    .insert(schema.instructors)
    .values({ userId: altUser.id, isActive: true })
    .returning();
  altInstructorId = altInstr.id;
});

afterAll(async () => {
  await db.delete(schema.reviewTemplates).where(eq(schema.reviewTemplates.instructorId, instructorId));
  await db.delete(schema.reviewTemplates).where(eq(schema.reviewTemplates.instructorId, altInstructorId));
  await db.delete(schema.instructors).where(eq(schema.instructors.id, instructorId));
  await db.delete(schema.instructors).where(eq(schema.instructors.id, altInstructorId));
  await db.delete(schema.users).where(eq(schema.users.email, 'tmpl-instr@test.local'));
  await db.delete(schema.users).where(eq(schema.users.email, 'tmpl-instr-alt@test.local'));
});

// ── Auth guard tests ──────────────────────────────────────────────────────────
describe('Templates API auth guards', () => {
  it('GET /api/templates returns 401 without session', async () => {
    expect((await request(app).get('/api/templates')).status).toBe(401);
  });
  it('GET /api/templates returns 403 for admin', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ role: 'admin' });
    expect((await agent.get('/api/templates')).status).toBe(403);
  });
  it('POST /api/templates returns 401 without session', async () => {
    expect((await request(app).post('/api/templates').send({ name: 'x', subject: 'y', body: 'z' })).status).toBe(401);
  });
});

// ── CRUD happy-path tests ─────────────────────────────────────────────────────
describe('Templates API CRUD', () => {
  let testApp: ReturnType<typeof buildTestApp>;
  let createdId: number;

  beforeAll(() => { testApp = buildTestApp(); });

  async function asInstructor() {
    const agent = request.agent(testApp);
    await agent.post('/test/login').send(instrUser(instructorId));
    return agent;
  }

  it('GET /api/templates returns empty array initially', async () => {
    const agent = await asInstructor();
    const res = await agent.get('/api/templates');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('POST /api/templates creates a template', async () => {
    const agent = await asInstructor();
    const res = await agent.post('/api/templates').send({
      name: 'Monthly Report',
      subject: 'Report for {{studentName}}',
      body: 'Hi {{studentName}}, here is your report for {{month}}.',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Monthly Report',
      subject: 'Report for {{studentName}}',
    });
    createdId = res.body.id;
  });

  it('GET /api/templates lists the created template', async () => {
    const agent = await asInstructor();
    const res = await agent.get('/api/templates');
    expect(res.status).toBe(200);
    expect(res.body.some((t: { id: number }) => t.id === createdId)).toBe(true);
  });

  it('POST /api/templates returns 400 when fields are missing', async () => {
    const agent = await asInstructor();
    const res = await agent.post('/api/templates').send({ name: 'Incomplete' });
    expect(res.status).toBe(400);
  });

  it('PUT /api/templates/:id updates the template', async () => {
    const agent = await asInstructor();
    const res = await agent.put(`/api/templates/${createdId}`).send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
  });

  it('PUT /api/templates/:id returns 404 for another instructor\'s template', async () => {
    const altAgent = request.agent(testApp);
    await altAgent.post('/test/login').send(instrUser(altInstructorId));
    const res = await altAgent.put(`/api/templates/${createdId}`).send({ name: 'Stolen' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/templates/:id returns 404 for another instructor\'s template', async () => {
    const altAgent = request.agent(testApp);
    await altAgent.post('/test/login').send(instrUser(altInstructorId));
    const res = await altAgent.delete(`/api/templates/${createdId}`);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/templates/:id removes the template', async () => {
    const agent = await asInstructor();
    const res = await agent.delete(`/api/templates/${createdId}`);
    expect(res.status).toBe(204);
  });

  it('GET /api/templates no longer lists deleted template', async () => {
    const agent = await asInstructor();
    const res = await agent.get('/api/templates');
    expect(res.status).toBe(200);
    expect(res.body.some((t: { id: number }) => t.id === createdId)).toBe(false);
  });
});
