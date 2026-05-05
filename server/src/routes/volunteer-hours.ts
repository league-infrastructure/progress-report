import { Router } from 'express';
import { eq, and, or, like, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { volunteerHours, volunteerSchedule } from '../db/schema';
import { isAdmin } from '../middleware/auth';

export const volunteerHoursRouter = Router();

volunteerHoursRouter.use(isAdmin);

// GET /api/admin/volunteer-hours/summary — YTD aggregate per volunteer with scheduled status
volunteerHoursRouter.get('/admin/volunteer-hours/summary', async (req, res, next) => {
  try {
    const { from, to } = req.query as Record<string, string | undefined>;
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
    const toDate = to ? new Date(to) : new Date();

    // Start from volunteerSchedule so all TA/VA volunteers appear even with zero hours.
    // The date range filter belongs on the JOIN condition, not WHERE, to preserve the LEFT JOIN.
    const rows = await db
      .select({
        volunteerName: volunteerSchedule.volunteerName,
        totalHours: sql<number>`coalesce(sum(${volunteerHours.hours}), 0)`,
        isScheduled: sql<boolean>`coalesce(${volunteerSchedule.isScheduled}, false)`,
      })
      .from(volunteerSchedule)
      .leftJoin(
        volunteerHours,
        and(
          eq(volunteerHours.volunteerName, volunteerSchedule.volunteerName),
          gte(volunteerHours.recordedAt, fromDate),
          lte(volunteerHours.recordedAt, toDate),
        ),
      )
      .where(or(
        like(volunteerSchedule.volunteerName, 'TA %'),
        like(volunteerSchedule.volunteerName, 'TA-%'),
        like(volunteerSchedule.volunteerName, 'VA %'),
        like(volunteerSchedule.volunteerName, 'VA-%'),
      ))
      .groupBy(volunteerSchedule.volunteerName, volunteerSchedule.isScheduled)
      .orderBy(sql`coalesce(sum(${volunteerHours.hours}), 0) desc`);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/volunteer-hours
volunteerHoursRouter.get('/admin/volunteer-hours', async (req, res, next) => {
  try {
    const { volunteerName, category, from, to } = req.query as Record<string, string | undefined>;

    const conditions = [
      or(
        like(volunteerHours.volunteerName, 'TA %'),
        like(volunteerHours.volunteerName, 'TA-%'),
        like(volunteerHours.volunteerName, 'VA %'),
        like(volunteerHours.volunteerName, 'VA-%'),
      )!,
    ];
    if (volunteerName) conditions.push(like(volunteerHours.volunteerName, `%${volunteerName}%`));
    if (category) conditions.push(eq(volunteerHours.category, category));
    if (from) conditions.push(gte(volunteerHours.recordedAt, new Date(from)));
    if (to) conditions.push(lte(volunteerHours.recordedAt, new Date(to)));

    const rows = await db
      .select()
      .from(volunteerHours)
      .where(conditions.length ? and(...(conditions as [typeof conditions[0]])) : undefined)
      .orderBy(volunteerHours.recordedAt);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/volunteer-hours
volunteerHoursRouter.post('/admin/volunteer-hours', async (req, res, next) => {
  try {
    const { volunteerName, category, hours, description, recordedAt } = req.body as {
      volunteerName?: string;
      category?: string;
      hours?: number;
      description?: string;
      recordedAt?: string;
    };

    if (!volunteerName || !category || hours === undefined || hours === null) {
      res.status(400).json({ error: 'volunteerName, category, and hours are required' });
      return;
    }

    const [row] = await db
      .insert(volunteerHours)
      .values({
        volunteerName,
        category,
        hours,
        description: description ?? null,
        recordedAt: recordedAt ? new Date(recordedAt) : undefined,
        source: 'manual',
      })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/volunteer-hours/:id
volunteerHoursRouter.put('/admin/volunteer-hours/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { volunteerName, category, hours, description, recordedAt } = req.body as {
      volunteerName?: string;
      category?: string;
      hours?: number;
      description?: string;
      recordedAt?: string;
    };

    const updates: Partial<typeof volunteerHours.$inferInsert> = {};
    if (volunteerName !== undefined) updates.volunteerName = volunteerName;
    if (category !== undefined) updates.category = category;
    if (hours !== undefined) updates.hours = hours;
    if (description !== undefined) updates.description = description;
    if (recordedAt !== undefined) updates.recordedAt = new Date(recordedAt);

    const [updated] = await db
      .update(volunteerHours)
      .set(updates)
      .where(eq(volunteerHours.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/volunteer-hours/:id
volunteerHoursRouter.delete('/admin/volunteer-hours/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    const [existing] = await db
      .select()
      .from(volunteerHours)
      .where(eq(volunteerHours.id, id));

    if (!existing) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }

    if (existing.source === 'pike13') {
      res.status(403).json({ error: 'Cannot delete Pike13-sourced entries' });
      return;
    }

    await db.delete(volunteerHours).where(eq(volunteerHours.id, id));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
