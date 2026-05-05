import { Router } from 'express';
import { eq, and, count, gte, lt } from 'drizzle-orm';
import { db } from '../db';
import { monthlyReviews, instructorStudents, students, pike13Tokens, studentAttendance, type ReviewStatus } from '../db/schema';
import { isActiveInstructor } from '../middleware/auth';
import { runSync } from '../services/pike13Sync';

export const instructorRouter = Router();

// GET /api/instructor/dashboard?month=YYYY-MM
instructorRouter.get('/instructor/dashboard', isActiveInstructor, async (req, res, next) => {
  try {
    const instructorId = req.session.user!.instructorId!;

    // Default to current month if not provided
    const monthParam = req.query.month as string | undefined;
    const month =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam)
        ? monthParam
        : new Date().toISOString().slice(0, 7);

    // Count reviews by status for this instructor and month
    const statusCounts = await db
      .select({
        status: monthlyReviews.status,
        count: count(),
      })
      .from(monthlyReviews)
      .where(and(eq(monthlyReviews.instructorId, instructorId), eq(monthlyReviews.month, month)))
      .groupBy(monthlyReviews.status);

    const counts = { pending: 0, draft: 0, sent: 0 };
    for (const row of statusCounts) {
      counts[row.status as ReviewStatus] = Number(row.count);
    }

    // Count assigned students
    const [studentCountRow] = await db
      .select({ count: count() })
      .from(instructorStudents)
      .where(eq(instructorStudents.instructorId, instructorId));

    res.json({
      month,
      totalStudents: Number(studentCountRow?.count ?? 0),
      pending: counts.pending,
      draft: counts.draft,
      sent: counts.sent,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/instructor/students?month=YYYY-MM — students with confirmed attendance in the given month
instructorRouter.get('/instructor/students', isActiveInstructor, async (req, res, next) => {
  try {
    const instructorId = req.session.user!.instructorId!;

    const monthParam = req.query.month as string | undefined;
    let year: number;
    let month: number;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      [year, month] = monthParam.split('-').map(Number);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1); // exclusive upper bound

    // All attendance records for this instructor in this month
    const attendanceRows = await db
      .select({
        studentId: studentAttendance.studentId,
        attendedAt: studentAttendance.attendedAt,
        studentName: students.name,
        githubUsername: students.githubUsername,
      })
      .from(studentAttendance)
      .innerJoin(students, eq(studentAttendance.studentId, students.id))
      .where(
        and(
          eq(studentAttendance.instructorId, instructorId),
          gte(studentAttendance.attendedAt, monthStart),
          lt(studentAttendance.attendedAt, monthEnd),
        ),
      )
      .orderBy(students.name, studentAttendance.attendedAt);

    // Group dates by student
    const studentMap = new Map<number, {
      id: number;
      name: string;
      githubUsername: string | null;
      attendanceDates: string[];
    }>();

    for (const row of attendanceRows) {
      if (!studentMap.has(row.studentId)) {
        studentMap.set(row.studentId, {
          id: row.studentId,
          name: row.studentName,
          githubUsername: row.githubUsername,
          attendanceDates: [],
        });
      }
      studentMap.get(row.studentId)!.attendanceDates.push(
        row.attendedAt.toISOString().slice(0, 10),
      );
    }

    // Fall back: if attendance table is empty (not yet synced), return all assigned students
    if (studentMap.size === 0) {
      const fallback = await db
        .select({
          id: students.id,
          name: students.name,
          githubUsername: students.githubUsername,
        })
        .from(instructorStudents)
        .innerJoin(students, eq(instructorStudents.studentId, students.id))
        .where(eq(instructorStudents.instructorId, instructorId))
        .orderBy(students.name);

      return res.json(fallback.map((s) => ({ ...s, attendanceDates: [] })));
    }

    res.json([...studentMap.values()]);
  } catch (err) {
    next(err);
  }
});

// POST /api/instructor/sync/pike13 — trigger a Pike13 sync using the instructor's own token
instructorRouter.post('/instructor/sync/pike13', isActiveInstructor, async (req, res, next) => {
  try {
    const instructorId = req.session.user!.instructorId!;

    const [token] = await db
      .select()
      .from(pike13Tokens)
      .where(eq(pike13Tokens.instructorId, instructorId));

    if (!token) {
      res.status(409).json({ error: 'No Pike13 token found. Please log out and back in.' });
      return;
    }

    let accessToken = token.accessToken;

    if (token.expiresAt && token.expiresAt < new Date()) {
      if (!token.refreshToken) {
        res.status(401).json({ error: 'Pike13 token expired. Please log out and back in.' });
        return;
      }

      const refreshRes = await fetch('https://pike13.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.PIKE13_CLIENT_ID,
          client_secret: process.env.PIKE13_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: token.refreshToken,
        }),
      });

      if (!refreshRes.ok) {
        res.status(401).json({ error: 'Pike13 token refresh failed. Please log out and back in.' });
        return;
      }

      const refreshData = (await refreshRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const expiresAt = refreshData.expires_in
        ? new Date(Date.now() + refreshData.expires_in * 1000)
        : null;

      await db
        .update(pike13Tokens)
        .set({
          accessToken: refreshData.access_token,
          refreshToken: refreshData.refresh_token ?? token.refreshToken,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(pike13Tokens.id, token.id));

      accessToken = refreshData.access_token;
    }

    const result = await runSync(db, accessToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
