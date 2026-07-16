import { Router } from 'express';
import { eq, and, ne, gte, lt, inArray } from 'drizzle-orm';
import { db } from '../db';
import { monthlyReviews, students, instructors, users, pike13Tokens, studentAttendance } from '../db/schema';
import { isActiveInstructor } from '../middleware/auth';
import { sendReviewEmail, sendTestReviewEmail } from '../services/email';
import { sendPike13Note, buildPike13NoteText } from '../services/pike13Notes';
import { generateReviewDraft } from '../services/reviewGenerator';

export const reviewsRouter = Router();

reviewsRouter.use(isActiveInstructor);

/** Whether the shared instructor has their own review for this student+month. */
type SharedReviewStatus = 'sent' | 'draft' | 'pending' | 'none';

/** One other instructor who also worked with this student during the month. */
interface SharedInstructor {
  instructorId: number;
  name: string;
  dates: string[]; // human-readable session dates, e.g. "Tue, May 6"
  /** Status of THIS instructor's own review for the student this month. */
  reviewStatus: SharedReviewStatus;
  /** ISO timestamp the shared instructor sent their review, if sent. */
  sentAt: string | null;
}

/**
 * Find instructors OTHER than `excludeInstructorId` who have recorded
 * attendance for `studentId` within the review's month. Lets the review page
 * warn that another instructor shares this student, so their work may overlap,
 * and show whether that instructor has already sent their own note.
 */
async function findSharedInstructors(
  studentId: number,
  month: string,
  excludeInstructorId: number,
): Promise<SharedInstructor[]> {
  const [yr, mo] = month.split('-').map((n) => parseInt(n, 10));
  if (!yr || !mo) return [];
  const monthStart = new Date(yr, mo - 1, 1);
  const monthEnd = new Date(yr, mo, 1);

  const rows = await db
    .select({
      instructorId: studentAttendance.instructorId,
      name: users.name,
      attendedAt: studentAttendance.attendedAt,
    })
    .from(studentAttendance)
    .innerJoin(instructors, eq(studentAttendance.instructorId, instructors.id))
    .innerJoin(users, eq(instructors.userId, users.id))
    .where(
      and(
        eq(studentAttendance.studentId, studentId),
        ne(studentAttendance.instructorId, excludeInstructorId),
        gte(studentAttendance.attendedAt, monthStart),
        lt(studentAttendance.attendedAt, monthEnd),
      ),
    )
    .orderBy(studentAttendance.attendedAt);

  const byInstructor = new Map<number, SharedInstructor>();
  for (const r of rows) {
    let entry = byInstructor.get(r.instructorId);
    if (!entry) {
      entry = { instructorId: r.instructorId, name: r.name, dates: [], reviewStatus: 'none', sentAt: null };
      byInstructor.set(r.instructorId, entry);
    }
    entry.dates.push(
      r.attendedAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    );
  }

  if (byInstructor.size === 0) return [];

  // Look up each shared instructor's own review for this student + month, so we
  // can tell the reviewing instructor whether the other instructor has already
  // sent their note.
  const reviewRows = await db
    .select({
      instructorId: monthlyReviews.instructorId,
      status: monthlyReviews.status,
      sentAt: monthlyReviews.sentAt,
    })
    .from(monthlyReviews)
    .where(
      and(
        eq(monthlyReviews.studentId, studentId),
        eq(monthlyReviews.month, month),
        inArray(monthlyReviews.instructorId, [...byInstructor.keys()]),
      ),
    );

  for (const r of reviewRows) {
    const entry = byInstructor.get(r.instructorId);
    if (!entry) continue;
    entry.reviewStatus = (r.status as SharedReviewStatus) ?? 'none';
    entry.sentAt = r.sentAt ? r.sentAt.toISOString() : null;
  }

  return [...byInstructor.values()];
}

function formatReview(
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

// GET /api/reviews?month=YYYY-MM
reviewsRouter.get('/reviews', async (req, res, next) => {
  try {
    const instructorId = req.session.user!.instructorId!;
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
      .where(
        and(eq(monthlyReviews.instructorId, instructorId), eq(monthlyReviews.month, month)),
      );

    res.json(rows.map((r) => formatReview(r.review, r.studentName, r.githubUsername)));
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews
reviewsRouter.post('/reviews', async (req, res, next) => {
  try {
    const instructorId = req.session.user!.instructorId!;
    const { studentId, month } = req.body as { studentId?: number; month?: string };

    if (!studentId || !month) {
      res.status(400).json({ error: 'studentId and month are required' });
      return;
    }

    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, studentId));

    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    const [review] = await db
      .insert(monthlyReviews)
      .values({ instructorId, studentId, month })
      .onConflictDoNothing()
      .returning();

    if (!review) {
      // Row already exists — return it
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
      res.status(200).json(formatReview(existing, student.name));
      return;
    }

    res.status(201).json(formatReview(review, student.name));
  } catch (err) {
    next(err);
  }
});

// GET /api/reviews/:id
reviewsRouter.get('/reviews/:id', async (req, res, next) => {
  try {
    const instructorId = req.session.user!.instructorId!;
    const id = parseInt(req.params.id, 10);

    const [row] = await db
      .select({ review: monthlyReviews, studentName: students.name, githubUsername: students.githubUsername })
      .from(monthlyReviews)
      .innerJoin(students, eq(monthlyReviews.studentId, students.id))
      .where(and(eq(monthlyReviews.id, id), eq(monthlyReviews.instructorId, instructorId)));

    if (!row) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }

    const sharedWith = await findSharedInstructors(
      row.review.studentId,
      row.review.month,
      instructorId,
    );

    res.json({ ...formatReview(row.review, row.studentName, row.githubUsername), sharedWith });
  } catch (err) {
    next(err);
  }
});

// PUT /api/reviews/:id
reviewsRouter.put('/reviews/:id', async (req, res, next) => {
  try {
    const instructorId = req.session.user!.instructorId!;
    const id = parseInt(req.params.id, 10);

    const [existing] = await db
      .select({ review: monthlyReviews, studentName: students.name })
      .from(monthlyReviews)
      .innerJoin(students, eq(monthlyReviews.studentId, students.id))
      .where(and(eq(monthlyReviews.id, id), eq(monthlyReviews.instructorId, instructorId)));

    if (!existing) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }

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

    res.json(formatReview(updated, existing.studentName));
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews/:id/send
reviewsRouter.post('/reviews/:id/send', async (req, res, next) => {
  try {
    const instructorId = req.session.user!.instructorId!;
    const id = parseInt(req.params.id, 10);

    const [existing] = await db
      .select({
        review: monthlyReviews,
        studentName: students.name,
        guardianEmail: students.guardianEmail,
        studentPike13Id: students.pike13SyncId,
        instructorName: users.name,
        instructorEmail: users.email,
        pike13AccessToken: pike13Tokens.accessToken,
      })
      .from(monthlyReviews)
      .innerJoin(students, eq(monthlyReviews.studentId, students.id))
      .innerJoin(instructors, eq(monthlyReviews.instructorId, instructors.id))
      .innerJoin(users, eq(instructors.userId, users.id))
      .leftJoin(pike13Tokens, eq(pike13Tokens.instructorId, instructors.id))
      .where(and(eq(monthlyReviews.id, id), eq(monthlyReviews.instructorId, instructorId)));

    if (!existing) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }

    // Idempotent: if already sent, return current state
    if (existing.review.status === 'sent') {
      res.json(formatReview(existing.review, existing.studentName));
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(monthlyReviews)
      .set({ status: 'sent', sentAt: now, updatedAt: now })
      .where(eq(monthlyReviews.id, id))
      .returning();

    const log = (req as unknown as { log?: { error: (...a: unknown[]) => void } }).log ?? console;

    // Primary: send via Pike13 note if the instructor has connected Pike13
    // and the student has a Pike13 person ID.
    if (existing.pike13AccessToken && existing.studentPike13Id) {
      sendPike13Note({
        accessToken: existing.pike13AccessToken,
        studentPike13Id: existing.studentPike13Id,
        noteText: buildPike13NoteText({
          reviewBody: updated.body ?? '',
          studentName: existing.studentName,
          month: updated.month,
          feedbackToken: updated.feedbackToken,
        }),
      }).catch((err) => {
        log.error(err, 'Pike13 note delivery failed');
      });
    } else if (existing.guardianEmail) {
      // Fallback: email if Pike13 is not connected for this instructor/student
      sendReviewEmail({
        toEmail: existing.guardianEmail,
        studentName: existing.studentName,
        month: updated.month,
        reviewBody: updated.body ?? '',
        feedbackToken: updated.feedbackToken,
      }).catch((err) => {
        log.error(err, 'SendGrid email failed');
      });
    }

    res.json(formatReview(updated, existing.studentName));
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews/:id/send-test — send a preview email to any address without marking as sent
reviewsRouter.post('/reviews/:id/send-test', async (req, res, next) => {
  try {
    const instructorId = req.session.user!.instructorId!;
    const id = parseInt(req.params.id, 10);
    const { testEmail } = req.body as { testEmail?: string };

    if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      res.status(400).json({ error: 'A valid testEmail is required' });
      return;
    }

    const [existing] = await db
      .select({ review: monthlyReviews, studentName: students.name })
      .from(monthlyReviews)
      .innerJoin(students, eq(monthlyReviews.studentId, students.id))
      .where(and(eq(monthlyReviews.id, id), eq(monthlyReviews.instructorId, instructorId)));

    if (!existing) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }

    await sendTestReviewEmail({
      toEmail: testEmail,
      studentName: existing.studentName,
      month: existing.review.month,
      reviewBody: existing.review.body ?? '',
      feedbackToken: existing.review.feedbackToken,
    });

    res.json({ ok: true, sentTo: testEmail });
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews/:id/send-test-pike13
// Sends a test note to the instructor's OWN Pike13 person profile (not the student's).
// Does not change the review status. Requires the instructor to have connected Pike13.
reviewsRouter.post('/reviews/:id/send-test-pike13', async (req, res, next) => {
  try {
    const instructorId = req.session.user!.instructorId!;
    const id = parseInt(req.params.id, 10);

    const [row] = await db
      .select({
        review: monthlyReviews,
        month: monthlyReviews.month,
        body: monthlyReviews.body,
        feedbackToken: monthlyReviews.feedbackToken,
        studentName: students.name,
        instructorEmail: users.email,
        instructorName: users.name,
        pike13AccessToken: pike13Tokens.accessToken,
      })
      .from(monthlyReviews)
      .innerJoin(students, eq(monthlyReviews.studentId, students.id))
      .innerJoin(instructors, eq(monthlyReviews.instructorId, instructors.id))
      .innerJoin(users, eq(instructors.userId, users.id))
      .leftJoin(pike13Tokens, eq(pike13Tokens.instructorId, instructors.id))
      .where(and(eq(monthlyReviews.id, id), eq(monthlyReviews.instructorId, instructorId)));

    if (!row) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }

    if (!row.pike13AccessToken) {
      res.status(400).json({
        error: 'You have not connected your Pike13 account. Connect it via the Pike13 OAuth flow first.',
      });
      return;
    }

    const testPersonId = process.env.PIKE13_TEST_PERSON_ID;
    if (!testPersonId) {
      res.status(503).json({
        error:
          'PIKE13_TEST_PERSON_ID is not set. ' +
          'Create a fake client profile in Pike13, copy the person ID from their profile URL ' +
          '(jtl.pike13.com/desk/clients/XXXXXX), and add PIKE13_TEST_PERSON_ID=XXXXXX to your .env.',
      });
      return;
    }

    const noteText =
      buildPike13NoteText({
        reviewBody: row.body?.trim()
          || `[PLACEHOLDER — review not written yet]\n\nDear LEAGUE Family,\n\nThis is a sample of what the full review will look like once the instructor writes or generates it. The complete message will appear here, followed by the feedback section below.`,
        studentName: row.studentName,
        month: row.month,
        feedbackToken: row.feedbackToken,
      }) + '\n\n[TEST NOTE — Sent to test profile, not the guardian]';

    await sendPike13Note({
      accessToken: row.pike13AccessToken,
      studentPike13Id: testPersonId,
      noteText,
    });

    res.json({ ok: true, pike13TestPersonId: testPersonId });
  } catch (err) {
    next(err);
  }
});

// POST /api/reviews/:id/generate-github-draft
reviewsRouter.post('/reviews/:id/generate-github-draft', async (req, res, next) => {
  try {
    const instructorId = req.session.user!.instructorId!;
    const id = parseInt(req.params.id, 10);

    // Verify this review belongs to the requesting instructor
    const [ownership] = await db
      .select({ id: monthlyReviews.id })
      .from(monthlyReviews)
      .where(and(eq(monthlyReviews.id, id), eq(monthlyReviews.instructorId, instructorId)));

    if (!ownership) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }

    const { template } = req.body as { template?: string };
    const result = await generateReviewDraft(id, template ?? undefined);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
