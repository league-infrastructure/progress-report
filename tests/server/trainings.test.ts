import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { trainingsRouter } from '../../server/src/routes/trainings';
import { errorHandler } from '../../server/src/middleware/errorHandler';
import type { SessionUser } from '../../server/src/types/session';
import { db } from '../../server/src/db';
import { computeTrainingAlerts, runTrainingCheck } from '../../server/src/services/trainingAlerts';

let staffId: number;
let volunteerId: number;
let ab506Id: number;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.post('/test/login', (req: express.Request, res: express.Response) => {
    req.session.user = req.body as SessionUser;
    res.json({ ok: true });
  });
  app.use('/api', trainingsRouter);
  app.use(errorHandler);
  return app;
}

const admin = (): SessionUser => ({ id: 1, name: 'Admin', email: 'a@t', isAdmin: true, isActiveInstructor: false });
const nonAdmin = (): SessionUser => ({ id: 2, name: 'Nope', email: 'n@t', isAdmin: false, isActiveInstructor: true });

beforeAll(async () => {
  const [s1] = await db.insert(schema.staffProfiles).values({ pike13StaffId: 9001, name: 'Trainer One', email: 't1@league', kind: 'instructor', active: true }).returning();
  staffId = s1.id;
  const [s2] = await db.insert(schema.staffProfiles).values({ pike13StaffId: 9002, name: 'Volunteer Two', email: 't2@league', kind: 'volunteer', active: true }).returning();
  volunteerId = s2.id;
  const [t] = await db.insert(schema.trainingTypes).values({ name: 'AB 506 Test', description: 'x', order: 1, active: true }).returning();
  ab506Id = t.id;
});

describe('admin trainings routes', () => {
  it('rejects non-admins', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(nonAdmin());
    const res = await agent.get('/api/admin/trainings');
    expect(res.status).toBe(403);
  });

  it('lists staff (instructors + volunteers) with the training catalog', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(admin());
    const res = await agent.get('/api/admin/trainings');
    expect(res.status).toBe(200);
    const names = res.body.staff.map((s: { name: string }) => s.name);
    expect(names).toEqual(expect.arrayContaining(['Trainer One', 'Volunteer Two']));
    expect(res.body.trainings.some((t: { name: string }) => t.name === 'AB 506 Test')).toBe(true);
  });

  it('PUT upserts a training record (met + drive link + expiry)', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(admin());
    const res = await agent
      .put(`/api/admin/trainings/${staffId}/${ab506Id}`)
      .send({ met: true, driveUrl: 'https://drive.google.com/x', expiresAt: '2027-01-01', notes: 'done' });
    expect(res.status).toBe(200);

    const row = db.select().from(schema.staffTrainings)
      .where(eq(schema.staffTrainings.staffProfileId, staffId)).get();
    expect(row?.met).toBe(true);
    expect(row?.driveUrl).toBe('https://drive.google.com/x');
    expect(row?.expiresAt?.getUTCFullYear()).toBe(2027);

    // Upsert again (idempotent on the unique pair)
    const res2 = await agent.put(`/api/admin/trainings/${staffId}/${ab506Id}`).send({ met: false });
    expect(res2.status).toBe(200);
    const row2 = db.select().from(schema.staffTrainings)
      .where(eq(schema.staffTrainings.staffProfileId, staffId)).get();
    expect(row2?.met).toBe(false);
  });

  it('check creates an admin notification when there are alerts', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(admin());
    const before = db.select().from(schema.adminNotifications).all().length;
    const res = await agent.post('/api/admin/trainings/check').send({});
    expect(res.status).toBe(200);
    expect(res.body.alertCount).toBeGreaterThan(0); // volunteerTwo has no AB506 record -> not met
    expect(res.body.notified).toBe(true);
    const after = db.select().from(schema.adminNotifications).all().length;
    expect(after).toBe(before + 1);
  });
});

describe('computeTrainingAlerts', () => {
  it('flags not-met, expiring-soon, and expired; not far-future met', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    // Trainer One: set met with expiry far future -> should NOT alert
    await db.update(schema.staffTrainings)
      .set({ met: true, expiresAt: new Date('2027-12-01T00:00:00Z') })
      .where(eq(schema.staffTrainings.staffProfileId, staffId));

    const alerts = await computeTrainingAlerts(now);
    // Volunteer Two has no record for AB 506 Test -> not_met
    const vol = alerts.find((a) => a.staffProfileId === volunteerId && a.trainingTypeId === ab506Id);
    expect(vol?.reason).toBe('not_met');
    // Trainer One far-future met -> not in alerts
    const trainerAb = alerts.find((a) => a.staffProfileId === staffId && a.trainingTypeId === ab506Id);
    expect(trainerAb).toBeUndefined();

    // Now make Trainer One expiring within window
    await db.update(schema.staffTrainings)
      .set({ met: true, expiresAt: new Date('2026-07-15T00:00:00Z') })
      .where(eq(schema.staffTrainings.staffProfileId, staffId));
    const alerts2 = await computeTrainingAlerts(now);
    const trainer2 = alerts2.find((a) => a.staffProfileId === staffId && a.trainingTypeId === ab506Id);
    expect(trainer2?.reason).toBe('expiring');

    // And expired
    await db.update(schema.staffTrainings)
      .set({ met: true, expiresAt: new Date('2026-06-01T00:00:00Z') })
      .where(eq(schema.staffTrainings.staffProfileId, staffId));
    const alerts3 = await computeTrainingAlerts(now);
    const trainer3 = alerts3.find((a) => a.staffProfileId === staffId && a.trainingTypeId === ab506Id);
    expect(trainer3?.reason).toBe('expired');
  });

  it('flags a met training with NO expiry as stale once updatedAt is older than the window', async () => {
    const now = new Date('2026-07-01T00:00:00Z');
    // met, no expiry, updated long ago (> 12 months) -> stale
    await db.update(schema.staffTrainings)
      .set({ met: true, expiresAt: null, updatedAt: new Date('2024-01-01T00:00:00Z') })
      .where(eq(schema.staffTrainings.staffProfileId, staffId));
    const stale = await computeTrainingAlerts(now);
    expect(stale.find((a) => a.staffProfileId === staffId && a.trainingTypeId === ab506Id)?.reason).toBe('stale');

    // met, no expiry, updated recently -> NOT flagged
    await db.update(schema.staffTrainings)
      .set({ met: true, expiresAt: null, updatedAt: new Date('2026-06-15T00:00:00Z') })
      .where(eq(schema.staffTrainings.staffProfileId, staffId));
    const fresh = await computeTrainingAlerts(now);
    expect(fresh.find((a) => a.staffProfileId === staffId && a.trainingTypeId === ab506Id)).toBeUndefined();
  });
});

describe('runTrainingCheck (shared by route + scheduler)', () => {
  it('creates a notification when there are alerts and reports counts', async () => {
    const before = db.select().from(schema.adminNotifications).all().length;
    const result = await runTrainingCheck(new Date('2026-07-01T00:00:00Z'));
    expect(result.alertCount).toBeGreaterThan(0);
    expect(result.notified).toBe(true);
    const after = db.select().from(schema.adminNotifications).all().length;
    expect(after).toBe(before + 1);
  });
});
