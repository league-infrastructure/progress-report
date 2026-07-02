import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db';
import { staffProfiles, trainingTypes, staffTrainings } from '../db/schema';
import { isAdmin } from '../middleware/auth';
import { computeTrainingAlerts, runTrainingCheck } from '../services/trainingAlerts';

export const trainingsRouter = Router();

trainingsRouter.use(isAdmin);

// GET /api/admin/trainings — staff profiles with their training records + the
// active training catalog, so the UI can render a staff × training grid.
trainingsRouter.get('/admin/trainings', async (_req, res, next) => {
  try {
    const staff = await db.select().from(staffProfiles).orderBy(asc(staffProfiles.name));
    const types = await db
      .select()
      .from(trainingTypes)
      .where(eq(trainingTypes.active, true))
      .orderBy(asc(trainingTypes.order));
    const records = await db.select().from(staffTrainings);
    const byStaff = new Map<number, typeof records>();
    for (const r of records) {
      const list = byStaff.get(r.staffProfileId) ?? [];
      list.push(r);
      byStaff.set(r.staffProfileId, list);
    }
    res.json({
      trainings: types.map((t) => ({ id: t.id, name: t.name, description: t.description })),
      staff: staff.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        kind: s.kind,
        active: s.active,
        records: (byStaff.get(s.id) ?? []).map((r) => ({
          trainingTypeId: r.trainingTypeId,
          met: r.met,
          driveUrl: r.driveUrl,
          expiresAt: r.expiresAt,
          notes: r.notes,
          updatedAt: r.updatedAt,
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/trainings/:staffId/:trainingTypeId — set a training record.
trainingsRouter.put('/admin/trainings/:staffId/:trainingTypeId', async (req, res, next) => {
  try {
    const staffId = Number(req.params.staffId);
    const trainingTypeId = Number(req.params.trainingTypeId);
    if (!staffId || !trainingTypeId) {
      res.status(400).json({ error: 'staffId and trainingTypeId required' });
      return;
    }
    const { met, driveUrl, expiresAt, notes } = req.body as {
      met?: boolean;
      driveUrl?: string | null;
      expiresAt?: string | null;
      notes?: string | null;
    };
    const values = {
      staffProfileId: staffId,
      trainingTypeId,
      met: Boolean(met),
      driveUrl: driveUrl?.trim() || null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      notes: notes?.trim() || null,
      updatedAt: new Date(),
    };
    await db
      .insert(staffTrainings)
      .values(values)
      .onConflictDoUpdate({
        target: [staffTrainings.staffProfileId, staffTrainings.trainingTypeId],
        set: { met: values.met, driveUrl: values.driveUrl, expiresAt: values.expiresAt, notes: values.notes, updatedAt: values.updatedAt },
      });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/trainings/alerts — trainings needing attention.
trainingsRouter.get('/admin/trainings/alerts', async (_req, res, next) => {
  try {
    const alerts = await computeTrainingAlerts();
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/trainings/check — run the check now: create an admin
// notification and send a summary email for anything unmet/expiring.
trainingsRouter.post('/admin/trainings/check', async (_req, res, next) => {
  try {
    const result = await runTrainingCheck();
    res.json(result);
  } catch (err) {
    next(err);
  }
});
