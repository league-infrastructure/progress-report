import { Router } from 'express';
import { eq, and, count, avg, sql, desc, notLike, inArray, gte, lt } from 'drizzle-orm';
import { db } from '../db';
import {
  instructors,
  users,
  instructorStudents,
  monthlyReviews,
  students,
  taCheckins,
  adminNotifications,
  serviceFeedback,
  pike13AdminToken,
  volunteerEventSchedule,
  adminSettings,
  studentAttendance,
  type ReviewStatus,
} from '../db/schema';
import { isAdmin } from '../middleware/auth';
import { runSync } from '../services/pike13Sync';
import { lastMondayOfMonth } from '../utils/dateUtils';
import sgMail from '@sendgrid/mail';
import { isSlackConfigured } from '../services/slack';
import { sendMonthlyReminders } from '../services/slackReminder';
import { runQuizCompletionCheck } from '../services/quizAlerts';
import { generateComplianceReport } from '../services/slackReport';
import { generateReviewDraft, sendReview } from '../services/reviewGenerator';
export const adminRouter = Router();

adminRouter.use(isAdmin);

// ---------- Instructor routes ----------

function ratioBadge(studentCount: number): 'ok' | 'warning' | 'alert' {
  if (studentCount <= 4) return 'ok';
  if (studentCount <= 6) return 'warning';
  return 'alert';
}

// GET /api/admin/instructors
adminRouter.get('/admin/instructors', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: instructors.id,
        userId: instructors.userId,
        name: users.name,
        email: users.email,
        isActive: instructors.isActive,
      })
      .from(instructors)
      .innerJoin(users, eq(instructors.userId, users.id))
      .where(notLike(users.email, '%example.com%'));

    const studentCounts = await db
      .select({
        instructorId: instructorStudents.instructorId,
        count: count(),
      })
      .from(instructorStudents)
      .groupBy(instructorStudents.instructorId);

    const countMap = new Map(studentCounts.map((r) => [r.instructorId, Number(r.count)]));

    const result = rows.map((r) => {
      const studentCount = countMap.get(r.id) ?? 0;
      return { ...r, studentCount, ratioBadge: ratioBadge(studentCount) };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/instructors/email-reminders
// Body: { instructorIds: number[], month?: string }
adminRouter.post('/admin/instructors/email-reminders', async (req, res, next) => {
  try {
    const { instructorIds, month: monthParam } = req.body as {
      instructorIds?: number[];
      month?: string;
    };

    if (!Array.isArray(instructorIds) || instructorIds.length === 0) {
      res.status(400).json({ error: 'instructorIds must be a non-empty array' });
      return;
    }

    const month =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam)
        ? monthParam
        : new Date().toISOString().slice(0, 7);

    const appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    if (!fromEmail) {
      res.status(500).json({ error: 'Email is not configured (SENDGRID_FROM_EMAIL missing)' });
      return;
    }
    sgMail.setApiKey(process.env.SENDGRID_API_KEY ?? '');

    // Load instructor details for the selected IDs
    const instructorRows = await db
      .select({ id: instructors.id, name: users.name, email: users.email })
      .from(instructors)
      .innerJoin(users, eq(instructors.userId, users.id))
      .where(inArray(instructors.id, instructorIds));

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const instr of instructorRows) {
      // Get all assigned students
      const assignedStudents = await db
        .select({ id: students.id, name: students.name })
        .from(instructorStudents)
        .innerJoin(students, eq(instructorStudents.studentId, students.id))
        .where(eq(instructorStudents.instructorId, instr.id))
        .orderBy(students.name);

      if (assignedStudents.length === 0) {
        skipped++;
        continue;
      }

      // Find students who already have a 'sent' review this month
      const sentReviews = await db
        .select({ studentId: monthlyReviews.studentId })
        .from(monthlyReviews)
        .where(
          and(
            eq(monthlyReviews.instructorId, instr.id),
            eq(monthlyReviews.month, month),
            eq(monthlyReviews.status, 'sent'),
          ),
        );
      const sentStudentIds = new Set(sentReviews.map((r) => r.studentId));

      // Only include students who don't yet have a sent review
      const needsReview = assignedStudents.filter((s) => !sentStudentIds.has(s.id));

      if (needsReview.length === 0) {
        skipped++;
        continue;
      }

      const studentLines = needsReview.map((s) => `  • ${s.name}`).join('\n');
      const [year, mon] = month.split('-');
      const monthLabel = new Date(Number(year), Number(mon) - 1).toLocaleString('en-US', {
        month: 'long',
        year: 'numeric',
      });

      const text = [
        `Hi ${instr.name},`,
        '',
        `This is a reminder to complete monthly progress reviews for ${monthLabel}.`,
        '',
        `Students needing reviews (${needsReview.length}):`,
        studentLines,
        '',
        `Log in to complete your reviews:`,
        `${appUrl}/reviews?month=${month}`,
        '',
        '— The LEAGUE Admin',
      ].join('\n');

      try {
        await sgMail.send({
          to: instr.email,
          from: fromEmail,
          subject: `[LEAGUE] Review reminder — ${needsReview.length} student${needsReview.length === 1 ? '' : 's'} pending for ${monthLabel}`,
          text,
        });
        sent++;
      } catch (emailErr) {
        errors.push(`${instr.email}: ${(emailErr as Error).message}`);
      }
    }

    res.json({ sent, skipped, errors });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/instructors/:id
adminRouter.patch('/admin/instructors/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { isActive } = req.body as { isActive?: boolean };

    if (typeof isActive !== 'boolean') {
      res.status(400).json({ error: 'isActive (boolean) is required' });
      return;
    }

    const [updated] = await db
      .update(instructors)
      .set({ isActive })
      .where(eq(instructors.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Instructor not found' });
      return;
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ---------- Compliance route ----------

// GET /api/admin/compliance?month=YYYY-MM
adminRouter.get('/admin/compliance', async (req, res, next) => {
  try {
    const monthParam = req.query.month as string | undefined;
    const month =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam)
        ? monthParam
        : new Date().toISOString().slice(0, 7);

    const recentMonday = lastMondayOfMonth(month);

    // Get all instructors with user info
    const allInstructors = await db
      .select({
        id: instructors.id,
        name: users.name,
      })
      .from(instructors)
      .innerJoin(users, eq(instructors.userId, users.id))
      .where(eq(instructors.isActive, true));

    // Review counts per instructor for this month
    const reviewCounts = await db
      .select({
        instructorId: monthlyReviews.instructorId,
        status: monthlyReviews.status,
        count: count(),
      })
      .from(monthlyReviews)
      .where(eq(monthlyReviews.month, month))
      .groupBy(monthlyReviews.instructorId, monthlyReviews.status);

    // Check-in submissions for the most recent Monday of the month
    const checkinRows = await db
      .select({ instructorId: taCheckins.instructorId })
      .from(taCheckins)
      .where(eq(taCheckins.weekOf, recentMonday));

    const checkinSet = new Set(checkinRows.map((r) => r.instructorId));

    const countMap = new Map<number, { pending: number; draft: number; sent: number }>();
    for (const row of reviewCounts) {
      if (!countMap.has(row.instructorId)) {
        countMap.set(row.instructorId, { pending: 0, draft: 0, sent: 0 });
      }
      countMap.get(row.instructorId)![row.status as ReviewStatus] = Number(row.count);
    }

    const result = allInstructors.map((i) => ({
      instructorId: i.id,
      name: i.name,
      pending: countMap.get(i.id)?.pending ?? 0,
      draft: countMap.get(i.id)?.draft ?? 0,
      sent: countMap.get(i.id)?.sent ?? 0,
      recentCheckinSubmitted: checkinSet.has(i.id),
    }));

    res.json({ month, rows: result });
  } catch (err) {
    next(err);
  }
});

// ---------- Notification routes ----------

// GET /api/admin/notifications?unread=true
adminRouter.get('/admin/notifications', async (req, res, next) => {
  try {
    const unreadOnly = req.query.unread === 'true';

    const conditions = unreadOnly ? [eq(adminNotifications.isRead, false)] : [];

    const rows = await db
      .select({
        id: adminNotifications.id,
        fromUserName: users.name,
        message: adminNotifications.message,
        isRead: adminNotifications.isRead,
        createdAt: adminNotifications.createdAt,
      })
      .from(adminNotifications)
      .innerJoin(users, eq(adminNotifications.fromUserId, users.id))
      .where(conditions.length ? and(...(conditions as [typeof conditions[0]])) : sql`true`)
      .orderBy(sql`${adminNotifications.createdAt} DESC`);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/feedback
adminRouter.get('/admin/feedback', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: serviceFeedback.id,
        reviewId: serviceFeedback.reviewId,
        studentName: students.name,
        instructorName: users.name,
        month: monthlyReviews.month,
        rating: serviceFeedback.rating,
        comment: serviceFeedback.comment,
        suggestion: serviceFeedback.suggestion,
        submittedAt: serviceFeedback.submittedAt,
      })
      .from(serviceFeedback)
      .innerJoin(monthlyReviews, eq(serviceFeedback.reviewId, monthlyReviews.id))
      .innerJoin(students, eq(monthlyReviews.studentId, students.id))
      .innerJoin(instructors, eq(monthlyReviews.instructorId, instructors.id))
      .innerJoin(users, eq(instructors.userId, users.id))
      .orderBy(desc(serviceFeedback.submittedAt));

    res.json(rows.map((r) => ({
      ...r,
      submittedAt: r.submittedAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/notifications/:id/read
adminRouter.patch('/admin/notifications/:id/read', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    const [updated] = await db
      .update(adminNotifications)
      .set({ isRead: true })
      .where(eq(adminNotifications.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ---------- Analytics route ----------

// GET /api/admin/analytics?month=YYYY-MM
adminRouter.get('/admin/analytics', async (req, res, next) => {
  try {
    const monthParam = req.query.month as string | undefined;
    const month =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam)
        ? monthParam
        : new Date().toISOString().slice(0, 7);

    // Total students assigned across all instructors
    const [totalStudentsRow] = await db
      .select({ count: count() })
      .from(instructorStudents);
    const totalStudents = Number(totalStudentsRow?.count ?? 0);

    // Sent reviews this month (across all instructors)
    const [sentRow] = await db
      .select({ count: count() })
      .from(monthlyReviews)
      .where(and(eq(monthlyReviews.month, month), eq(monthlyReviews.status, 'sent')));
    const totalSent = Number(sentRow?.count ?? 0);

    // "Still need to send" = every student who hasn't received a sent review this month
    const needToSend = Math.max(0, totalStudents - totalSent);

    // Feedback stats (all-time)
    const [feedbackStats] = await db
      .select({
        totalFeedback: count(),
        avgRating: avg(serviceFeedback.rating),
      })
      .from(serviceFeedback);

    // Feedback count for this month's sent reviews
    const monthFeedback = await db
      .select({ count: count() })
      .from(serviceFeedback)
      .innerJoin(monthlyReviews, eq(serviceFeedback.reviewId, monthlyReviews.id))
      .where(eq(monthlyReviews.month, month));

    const monthFeedbackCount = Number(monthFeedback[0]?.count ?? 0);
    const feedbackRate = totalSent > 0 ? Math.round((monthFeedbackCount / totalSent) * 100) : 0;

    // Top suggestions (all-time)
    const suggestionRows = await db
      .select({
        suggestion: serviceFeedback.suggestion,
        count: count(),
      })
      .from(serviceFeedback)
      .where(sql`${serviceFeedback.suggestion} IS NOT NULL`)
      .groupBy(serviceFeedback.suggestion)
      .orderBy(desc(count()))
      .limit(5);

    res.json({
      month,
      totalSent,
      needToSend,
      totalFeedback: Number(feedbackStats?.totalFeedback ?? 0),
      monthFeedbackCount,
      feedbackRate,
      avgRating: feedbackStats?.avgRating ? parseFloat(Number(feedbackStats.avgRating).toFixed(1)) : null,
      topSuggestions: suggestionRows.map((r) => ({ suggestion: r.suggestion, count: Number(r.count) })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Volunteer schedule route ----------

// GET /api/admin/volunteer-schedule?weekOf=YYYY-MM-DD
adminRouter.get('/admin/volunteer-schedule', async (req, res, next) => {
  try {
    const weekOfParam = req.query.weekOf as string | undefined;

    let weekStart: Date;
    if (weekOfParam && /^\d{4}-\d{2}-\d{2}$/.test(weekOfParam)) {
      weekStart = new Date(weekOfParam + 'T00:00:00.000Z');
    } else {
      weekStart = new Date();
      const day = weekStart.getUTCDay();
      const daysToMonday = day === 0 ? -6 : 1 - day;
      weekStart.setUTCDate(weekStart.getUTCDate() + daysToMonday);
      weekStart.setUTCHours(0, 0, 0, 0);
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const events = await db
      .select()
      .from(volunteerEventSchedule)
      .where(
        and(
          gte(volunteerEventSchedule.startAt, weekStart),
          lt(volunteerEventSchedule.startAt, weekEnd),
        ),
      )
      .orderBy(volunteerEventSchedule.startAt);

    res.json(
      events.map((e) => ({
        eventOccurrenceId: e.eventOccurrenceId,
        startAt: e.startAt.toISOString(),
        endAt: e.endAt.toISOString(),
        instructors: e.instructors,
        volunteers: e.volunteers,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ---------- Pike13 OAuth routes ----------

// GET /api/admin/pike13/connect
adminRouter.get('/admin/pike13/connect', (_req, res) => {
  const clientId = process.env.PIKE13_CLIENT_ID;
  const callbackUrl = process.env.PIKE13_CALLBACK_URL;
  const authUrl = `https://pike13.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl ?? '')}&response_type=code`;
  res.redirect(authUrl);
});

// GET /api/admin/pike13/callback
adminRouter.get('/admin/pike13/callback', async (req, res, next) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      res.status(400).json({ error: 'Missing code parameter' });
      return;
    }

    const tokenRes = await fetch('https://pike13.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.PIKE13_CLIENT_ID,
        client_secret: process.env.PIKE13_CLIENT_SECRET,
        redirect_uri: process.env.PIKE13_CALLBACK_URL,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      res.status(502).json({ error: 'Failed to exchange code with Pike13' });
      return;
    }

    const data = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await db.delete(pike13AdminToken);
    await db.insert(pike13AdminToken).values({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt,
    });

    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/pike13/status
adminRouter.get('/admin/pike13/status', async (_req, res, next) => {
  try {
    const rows = await db.select({ id: pike13AdminToken.id }).from(pike13AdminToken);
    res.json({ connected: rows.length > 0 });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/sync/pike13
adminRouter.post('/admin/sync/pike13', async (_req, res, next) => {
  try {
    const [token] = await db.select().from(pike13AdminToken);

    if (!token) {
      res.status(409).json({ error: 'Pike13 not connected' });
      return;
    }

    let accessToken = token.accessToken;

    // Refresh if expired
    if (token.expiresAt && token.expiresAt < new Date()) {
      if (!token.refreshToken) {
        res.status(401).json({ error: 'Pike13 token expired and no refresh token available' });
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
        res.status(401).json({ error: 'Pike13 token refresh failed' });
        return;
      }

      const refreshData = await refreshRes.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const expiresAt = refreshData.expires_in
        ? new Date(Date.now() + refreshData.expires_in * 1000)
        : null;

      await db.update(pike13AdminToken).set({
        accessToken: refreshData.access_token,
        refreshToken: refreshData.refresh_token ?? token.refreshToken,
        expiresAt,
      }).where(eq(pike13AdminToken.id, token.id));

      accessToken = refreshData.access_token;
    }

    const result = await runSync(db, accessToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------- Slack routes ----------

// GET /api/admin/slack/status
adminRouter.get('/admin/slack/status', (_req, res) => {
  res.json({
    configured: isSlackConfigured(),
    hasChannel: !!process.env.SLACK_REVIEWS_CHANNEL,
  });
});

// POST /api/admin/slack/remind
// Body: { month?: string }
// Sends a Slack DM to every active instructor who still has unsent reviews for the month.
adminRouter.post('/admin/slack/remind', async (req, res, next) => {
  try {
    if (!isSlackConfigured()) {
      res.status(503).json({ error: 'Slack is not configured (SLACK_BOT_TOKEN missing)' });
      return;
    }

    const { month: monthParam } = req.body as { month?: string };
    const month =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam)
        ? monthParam
        : new Date().toISOString().slice(0, 7);

    const result = await sendMonthlyReminders(month);
    res.json({ month, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/slack/quiz-check
// Body: { month?: string }
// Runs the quiz-completion sweep on demand (same logic as the weekly scheduler):
// DMs each instructor scheduled with a student this month who has incomplete quizzes.
adminRouter.post('/admin/slack/quiz-check', async (req, res, next) => {
  try {
    if (!isSlackConfigured()) {
      res.status(503).json({ error: 'Slack is not configured (SLACK_BOT_TOKEN missing)' });
      return;
    }

    const { month: monthParam } = req.body as { month?: string };
    const month =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam)
        ? monthParam
        : new Date().toISOString().slice(0, 7);

    const result = await runQuizCompletionCheck(month);
    res.json({ month, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/slack/report
// Body: { month?: string, postToChannel?: boolean }
// Builds a compliance summary and optionally posts it to SLACK_REVIEWS_CHANNEL.
adminRouter.post('/admin/slack/report', async (req, res, next) => {
  try {
    if (!isSlackConfigured()) {
      res.status(503).json({ error: 'Slack is not configured (SLACK_BOT_TOKEN missing)' });
      return;
    }

    const { month: monthParam, postToChannel = false } = req.body as {
      month?: string;
      postToChannel?: boolean;
    };
    const month =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam)
        ? monthParam
        : new Date().toISOString().slice(0, 7);

    const result = await generateComplianceReport(month, postToChannel);
    res.json({ month, ...result });
  } catch (err) {
    next(err);
  }
});

// ---------- Admin user management ----------

// GET /api/admin/admins — list all admin emails
adminRouter.get('/admin/admins', async (_req, res, next) => {
  try {
    const admins = await db
      .select({ id: adminSettings.id, email: adminSettings.email, createdAt: adminSettings.createdAt })
      .from(adminSettings)
      .orderBy(adminSettings.createdAt);
    res.json(admins);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/admins — grant admin by email
// Body: { email: string }
adminRouter.post('/admin/admins', async (req, res, next) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'email (string) is required' });
      return;
    }
    const normalized = email.trim().toLowerCase();
    const [existing] = await db.select().from(adminSettings).where(eq(adminSettings.email, normalized));
    if (existing) {
      res.status(409).json({ error: 'That email already has admin access' });
      return;
    }
    const [created] = await db.insert(adminSettings).values({ email: normalized }).returning();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/admins/:id — revoke admin
adminRouter.delete('/admin/admins/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [deleted] = await db.delete(adminSettings).where(eq(adminSettings.id, id)).returning();
    if (!deleted) {
      res.status(404).json({ error: 'Admin record not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Admin student search ----------

// GET /api/admin/students?q=name — active students (checked in within the past 30 days)
adminRouter.get('/admin/students', async (req, res, next) => {
  try {
    const q = ((req.query.q as string) ?? '').trim().toLowerCase();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Only include students who have a check-in in the past 30 days
    const recentCheckins = await db
      .selectDistinct({ studentId: studentAttendance.studentId })
      .from(studentAttendance)
      .where(gte(studentAttendance.attendedAt, thirtyDaysAgo));
    const activeStudentIds = new Set(recentCheckins.map((r) => r.studentId));

    const rows = await db
      .select({
        id: students.id,
        name: students.name,
        githubUsername: students.githubUsername,
        instructorId: instructorStudents.instructorId,
        instructorName: users.name,
        lastSeenAt: instructorStudents.lastSeenAt,
      })
      .from(students)
      .leftJoin(instructorStudents, eq(instructorStudents.studentId, students.id))
      .leftJoin(instructors, eq(instructorStudents.instructorId, instructors.id))
      .leftJoin(users, eq(instructors.userId, users.id))
      .orderBy(students.name);

    // Deduplicate: one row per student, keeping the most-recently-seen instructor assignment
    const seen = new Map<number, typeof rows[0]>();
    for (const row of rows) {
      if (!activeStudentIds.has(row.id)) continue;
      const existing = seen.get(row.id);
      if (!existing) {
        seen.set(row.id, row);
      } else if (row.lastSeenAt && (!existing.lastSeenAt || row.lastSeenAt > existing.lastSeenAt)) {
        seen.set(row.id, row);
      }
    }
    const deduped = [...seen.values()];

    const filtered = q ? deduped.filter((r) => r.name.toLowerCase().includes(q)) : deduped;
    res.json(filtered);
  } catch (err) {
    next(err);
  }
});

// ---------- Admin review endpoints (no instructor-ownership filter) ----------

function formatAdminReview(
  review: typeof monthlyReviews.$inferSelect,
  studentName: string,
  githubUsername: string | null = null,
) {
  return {
    id: review.id,
    studentId: review.studentId,
    studentName,
    githubUsername,
    month: review.month,
    status: review.status,
    subject: review.subject,
    body: review.body,
    sentAt: review.sentAt ? review.sentAt.toISOString() : null,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

// GET /api/admin/reviews?month=YYYY-MM — all reviews for the month
adminRouter.get('/admin/reviews', async (req, res, next) => {
  try {
    const monthParam = req.query.month as string | undefined;
    const month =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam)
        ? monthParam
        : new Date().toISOString().slice(0, 7);

    const rows = await db
      .select({
        review: monthlyReviews,
        studentName: students.name,
        githubUsername: students.githubUsername,
      })
      .from(monthlyReviews)
      .innerJoin(students, eq(monthlyReviews.studentId, students.id))
      .where(eq(monthlyReviews.month, month));

    res.json(rows.map((r) => formatAdminReview(r.review, r.studentName, r.githubUsername)));
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/reviews — create a review for any student
// Body: { studentId, instructorId, month }
adminRouter.post('/admin/reviews', async (req, res, next) => {
  try {
    const { studentId, instructorId, month } = req.body as {
      studentId?: number;
      instructorId?: number;
      month?: string;
    };

    if (!studentId || !instructorId || !month || !/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: 'studentId, instructorId, and month (YYYY-MM) are required' });
      return;
    }

    const [student] = await db.select().from(students).where(eq(students.id, studentId));
    if (!student) { res.status(404).json({ error: 'Student not found' }); return; }

    const [review] = await db
      .insert(monthlyReviews)
      .values({ instructorId, studentId, month })
      .onConflictDoNothing()
      .returning();

    if (!review) {
      const [existing] = await db
        .select()
        .from(monthlyReviews)
        .where(
          and(
            eq(monthlyReviews.instructorId, instructorId),
            eq(monthlyReviews.studentId, studentId),
            eq(monthlyReviews.month, month),
          ),
        );
      res.json(formatAdminReview(existing, student.name, student.githubUsername));
      return;
    }

    res.status(201).json(formatAdminReview(review, student.name, student.githubUsername));
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/reviews/:id
adminRouter.get('/admin/reviews/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    const [row] = await db
      .select({ review: monthlyReviews, studentName: students.name, githubUsername: students.githubUsername })
      .from(monthlyReviews)
      .innerJoin(students, eq(monthlyReviews.studentId, students.id))
      .where(eq(monthlyReviews.id, id));

    if (!row) { res.status(404).json({ error: 'Review not found' }); return; }
    res.json(formatAdminReview(row.review, row.studentName, row.githubUsername));
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/reviews/:id
adminRouter.put('/admin/reviews/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    const [existing] = await db
      .select({ review: monthlyReviews, studentName: students.name, githubUsername: students.githubUsername })
      .from(monthlyReviews)
      .innerJoin(students, eq(monthlyReviews.studentId, students.id))
      .where(eq(monthlyReviews.id, id));

    if (!existing) { res.status(404).json({ error: 'Review not found' }); return; }
    if (existing.review.status === 'sent') {
      res.status(409).json({ error: 'Cannot edit a sent review' });
      return;
    }

    const { subject, body } = req.body as { subject?: string; body?: string };
    const [updated] = await db
      .update(monthlyReviews)
      .set({ subject, body, status: 'draft', updatedAt: new Date() })
      .where(eq(monthlyReviews.id, id))
      .returning();

    res.json(formatAdminReview(updated, existing.studentName, existing.githubUsername));
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/reviews/:id/send
adminRouter.post('/admin/reviews/:id/send', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await sendReview(id);
    const [row] = await db
      .select({ review: monthlyReviews, studentName: students.name, githubUsername: students.githubUsername })
      .from(monthlyReviews)
      .innerJoin(students, eq(monthlyReviews.studentId, students.id))
      .where(eq(monthlyReviews.id, id));
    if (!row) { res.status(404).json({ error: 'Review not found' }); return; }
    res.json(formatAdminReview(row.review, row.studentName, row.githubUsername));
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/reviews/:id/generate-github-draft
adminRouter.post('/admin/reviews/:id/generate-github-draft', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [ownership] = await db.select({ id: monthlyReviews.id }).from(monthlyReviews).where(eq(monthlyReviews.id, id));
    if (!ownership) { res.status(404).json({ error: 'Review not found' }); return; }
    const { template } = req.body as { template?: string };
    const result = await generateReviewDraft(id, template ?? undefined);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
