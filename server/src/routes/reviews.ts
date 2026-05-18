import { Router } from 'express';
import { eq, and, gte, lt } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';
import { monthlyReviews, students, instructors, users, studentAttendance, pike13Tokens } from '../db/schema';
import { isActiveInstructor } from '../middleware/auth';
import { sendReviewEmail, sendTestReviewEmail } from '../services/email';
import { sendPike13Note, buildPike13NoteText } from '../services/pike13Notes';

export const reviewsRouter = Router();

reviewsRouter.use(isActiveInstructor);

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

    res.json(formatReview(row.review, row.studentName, row.githubUsername));
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
// Fetches the student's GitHub push events for the review month and uses
// Claude to write a draft review body.
reviewsRouter.post('/reviews/:id/generate-github-draft', async (req, res, next) => {
  try {
    const instructorId = req.session.user!.instructorId!;
    const id = parseInt(req.params.id, 10);

    const [row] = await db
      .select({
        review: monthlyReviews,
        studentName: students.name,
        githubUsername: students.githubUsername,
        guardianName: students.guardianName,
        instructorName: users.name,
        instructorEmail: users.email,
      })
      .from(monthlyReviews)
      .innerJoin(students, eq(monthlyReviews.studentId, students.id))
      .innerJoin(instructors, eq(monthlyReviews.instructorId, instructors.id))
      .innerJoin(users, eq(instructors.userId, users.id))
      .where(and(eq(monthlyReviews.id, id), eq(monthlyReviews.instructorId, instructorId)));

    if (!row) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }

    if (!row.githubUsername) {
      res.status(400).json({ error: 'This student has no GitHub username linked in Pike13' });
      return;
    }

    // Strip any embedded password (e.g. "username:password" stored in Pike13)
    const { studentName, guardianName, instructorName, instructorEmail, review } = row;
    const githubUsername = (row.githubUsername ?? '').split(':')[0].trim();
    const month = review.month; // YYYY-MM
    const reviewMonthYear = month.split('-');
    const reviewYear = parseInt(reviewMonthYear[0], 10);
    const reviewMon = parseInt(reviewMonthYear[1], 10);
    const monthLabel = new Date(Date.UTC(reviewYear, reviewMon - 1, 15)).toLocaleString('en-US', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    });

    // Search the past 30 days so recent activity is never missed
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Fetch GitHub events (public, rate-limited to 60/hr without token)
    const ghHeaders: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'LEAGUE-Review-App',
    };
    if (process.env.GITHUB_TOKEN) {
      ghHeaders['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const ghRes = await fetch(
      `https://api.github.com/users/${encodeURIComponent(githubUsername)}/events?per_page=100`,
      { headers: ghHeaders },
    );

    if (ghRes.status === 404) {
      res.status(400).json({ error: `GitHub user "${githubUsername}" not found` });
      return;
    }
    if (!ghRes.ok) {
      res.status(502).json({ error: `GitHub API returned ${ghRes.status}` });
      return;
    }

    interface GithubEvent {
      type: string;
      created_at: string;
      repo: { name: string };
      payload: {
        ref?: string;
        commits?: Array<{ sha: string; message: string }>;
      };
    }

    const events = (await ghRes.json()) as GithubEvent[];

    // Filter to PushEvents within the past 30 days
    const pushEvents = events.filter((e) => {
      if (e.type !== 'PushEvent') return false;
      const d = new Date(e.created_at);
      return d >= since && d <= now;
    });

    if (pushEvents.length === 0) {
      res.status(400).json({
        error: `No GitHub push activity found for @${githubUsername} in the past 30 days`,
      });
      return;
    }

    // Collect commit messages from push events (always available, even for private repos)
    // and track unique repos + SHAs for detail enrichment attempts
    interface EnrichedCommit {
      sha: string;
      message: string;
      filesChanged: string[];
      additions: number;
      deletions: number;
    }

    interface RepoData {
      shortName: string;
      commits: EnrichedCommit[];
    }

    const repoData = new Map<string, RepoData>();

    // Seed with commit messages from push event payloads (baseline — always works)
    for (const event of pushEvents) {
      const fullRepo = event.repo.name;
      const shortName = fullRepo.split('/').pop() ?? fullRepo;
      if (!repoData.has(fullRepo)) repoData.set(fullRepo, { shortName, commits: [] });
      const entry = repoData.get(fullRepo)!;

      for (const c of event.payload.commits ?? []) {
        const msg = (c.message ?? '').split('\n')[0].trim();
        if (!msg || msg.toLowerCase().startsWith('merge ')) continue;
        const sha = (c.sha ?? '').slice(0, 7);
        // Deduplicate by message
        if (!entry.commits.find((x) => x.message === msg)) {
          entry.commits.push({ sha, message: msg, filesChanged: [], additions: 0, deletions: 0 });
        }
      }
    }

    // Try to enrich each repo's commits with file details via the commits list API.
    // This works for public repos and private repos where GITHUB_TOKEN has access.
    // Failures are silently ignored — we always have the baseline commit messages.
    for (const [fullRepo, entry] of repoData) {
      try {
        const listRes = await fetch(
          `https://api.github.com/repos/${fullRepo}/commits?author=${encodeURIComponent(githubUsername)}&since=${since.toISOString()}&until=${now.toISOString()}&per_page=30`,
          { headers: ghHeaders },
        );
        if (!listRes.ok) continue;

        const list = await listRes.json() as Array<{ sha: string; commit: { message: string } }>;

        // Fetch details for up to 5 commits per repo
        for (const c of list.slice(0, 5)) {
          const msg = c.commit.message.split('\n')[0].trim();
          if (!msg || msg.toLowerCase().startsWith('merge ')) continue;

          try {
            const detailRes = await fetch(
              `https://api.github.com/repos/${fullRepo}/commits/${c.sha}`,
              { headers: ghHeaders },
            );
            if (!detailRes.ok) continue;

            const detail = await detailRes.json() as {
              stats?: { additions: number; deletions: number };
              files?: Array<{ filename: string }>;
            };

            // Update or insert enriched commit
            const existing = entry.commits.find((x) => x.message === msg);
            const enriched: EnrichedCommit = {
              sha: c.sha.slice(0, 7),
              message: msg,
              filesChanged: (detail.files ?? []).map((f) => f.filename),
              additions: detail.stats?.additions ?? 0,
              deletions: detail.stats?.deletions ?? 0,
            };
            if (existing) {
              Object.assign(existing, enriched);
            } else if (entry.commits.length < 15) {
              entry.commits.push(enriched);
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    // Drop repos where we ended up with no commits at all
    for (const [key, entry] of repoData) {
      if (entry.commits.length === 0) repoData.delete(key);
    }

    // Fetch attendance dates for this student+instructor in the review month
    const monthStart = new Date(reviewYear, reviewMon - 1, 1);
    const monthEnd = new Date(reviewYear, reviewMon, 1);

    const attendanceRows = await db
      .select({ attendedAt: studentAttendance.attendedAt })
      .from(studentAttendance)
      .where(
        and(
          eq(studentAttendance.studentId, review.studentId),
          eq(studentAttendance.instructorId, instructorId),
          gte(studentAttendance.attendedAt, monthStart),
          lt(studentAttendance.attendedAt, monthEnd),
        ),
      )
      .orderBy(studentAttendance.attendedAt);

    const attendanceDates = attendanceRows.map((r) =>
      r.attendedAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    );

    // Files that indicate container/environment issues rather than curriculum work
    const INFRA_FILE_PATTERNS = /^(dockerfile|docker-compose|\.dockerignore|requirements\.txt|pom\.xml|build\.gradle|\.gitignore|\.env|readme\.md|\.github|__pycache__|\.classpath|\.project|\.settings)/i;

    // Detect if a file path is inside a lessons directory
    function isLessonFile(filePath: string): boolean {
      return /(?:^|\/)lessons?\//i.test(filePath);
    }

    // Extract lesson number from a path like lessons/03_loops/main.py → 3
    function lessonNumber(filePath: string): number | null {
      const m = filePath.match(/lessons?\/([\d]+)/i);
      return m ? parseInt(m[1], 10) : null;
    }

    // Extract human-readable lesson name from a path like lessons/03_loops/main.py → "loops"
    function lessonName(filePath: string): string | null {
      const m = filePath.match(/lessons?\/([^/]+)/i);
      if (!m) return null;
      // Strip leading digits and separator: "03_loops" → "loops", "05-functions" → "functions"
      const name = m[1].replace(/^\d+[_\-]?/, '').replace(/_/g, ' ').trim();
      return name || m[1];
    }

    // Strip the numeric prefix from the lesson folder in a file path for clean display
    // e.g. lessons/03_loops/main.py → lessons/loops/main.py
    function cleanLessonPath(filePath: string): string {
      return filePath.replace(/(lessons?\/)[\d]+[_\-]?/i, '$1');
    }

    // Build curriculum-focused commit summary
    // Only include files inside lessons/ directories; ignore infra files
    let highestLesson = 0;
    const lessonsSeen = new Map<number, string>(); // number → human-readable name
    let totalCommits = 0;

    const commitSummary = [...repoData.entries()]
      .slice(0, 3)
      .map(([, { shortName, commits }]) => {
        const commitLines: string[] = [];

        for (const c of commits.slice(0, 8)) {
          totalCommits++;
          const lessonFiles = c.filesChanged.filter(
            (f) => isLessonFile(f) && !INFRA_FILE_PATTERNS.test(f.split('/').pop() ?? f),
          );

          // Track lesson progression
          for (const f of lessonFiles) {
            const n = lessonNumber(f);
            if (n !== null) {
              const name = lessonName(f) ?? String(n);
              lessonsSeen.set(n, name);
              if (n > highestLesson) highestLesson = n;
            }
          }

          // Skip commits with no lesson-directory changes
          if (lessonFiles.length === 0) continue;

          // Show the lesson folder path with number stripped (e.g. lessons/loops) rather than lessons/03_loops
          const fileSummary = lessonFiles
            .slice(0, 4)
            .map((f) => {
              // Show up to the lesson subfolder + filename, with numeric prefix removed
              const parts = cleanLessonPath(f).split('/');
              const lessonIdx = parts.findIndex((p) => /^lessons?$/i.test(p));
              return lessonIdx >= 0
                ? parts.slice(lessonIdx, lessonIdx + 3).join('/')
                : parts.slice(-2).join('/');
            })
            .filter((v, i, a) => a.indexOf(v) === i) // deduplicate
            .join(', ');

          const statPart = (c.additions || c.deletions) ? ` +${c.additions}/-${c.deletions}` : '';
          commitLines.push(`  - ${c.message} [${fileSummary}]${statPart}`);
        }

        if (commitLines.length === 0) return null;
        return `Repository: ${shortName}\n${commitLines.join('\n')}`;
      })
      .filter(Boolean)
      .join('\n\n');

    // Summary of lesson progress for the prompt — use names, not numbers
    const highestLessonName = lessonsSeen.get(highestLesson);
    const allLessonNames = [...lessonsSeen.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, name]) => name);
    const lessonProgressNote = highestLessonName
      ? `Current curriculum position: working on "${highestLessonName}"${allLessonNames.length > 1 ? ` (also covered: ${allLessonNames.slice(0, -1).join(', ')})` : ''}.`
      : '';

    if (!commitSummary) {
      res.status(400).json({
        error: `No curriculum (lessons/) activity found for @${githubUsername} in the past 30 days. Only infrastructure or non-lesson changes were detected.`,
      });
      return;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
      return;
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You are an encouraging coding instructor writing a monthly progress review for a parent/guardian.

Tone rules:
- Warm, positive, and encouraging throughout — frame slow progress as steady, consistent growth
- Highlight the positives first and foremost
- Focus on the most advanced lessons the student worked on — these show where they are in the curriculum now
- Refer to lessons by their topic name (e.g. "loops", "functions", "classes") — NEVER by a number like "lesson 3" or "lesson 7"
- Only briefly mention earlier topics if they're directly relevant to understanding the advanced work
- Do NOT make high-achieving students feel they need to do more — keep any suggestions light and optional-sounding
- Base everything ONLY on the commit data and file paths provided; never invent details

Structure (no headers, flowing paragraphs):
1. Progress paragraph — what they worked on, what topic they've reached, what concepts that topic covers
2. Effort & highlights paragraph — specific things done well, how the work builds their skills
3. Instructor notes (2–4 sentences only) — one gentle suggestion for the student if helpful, then a brief plan for how the instructor will support them next (e.g. "In our next sessions we'll build on X by introducing Y"). Keep this encouraging, never prescriptive.`,
      messages: [
        {
          role: 'user',
          content: `Write a monthly progress review for ${studentName} (${monthLabel}) to send to their parent/guardian.
${attendanceDates.length > 0 ? `\nClass attendance this month: ${attendanceDates.join(', ')} (${attendanceDates.length} session${attendanceDates.length === 1 ? '' : 's'})` : ''}
${lessonProgressNote ? `\n${lessonProgressNote}` : ''}

Curriculum activity (lessons/ directory, past 30 days):
${commitSummary}

Instructions:
- Open with attendance and the topic they're currently working on (use the topic name, not a number)
- Lead with the most advanced topic work, not the earliest
- Keep any improvement suggestion light — one sentence max, framed as "something to explore" not a gap
- End with 2–3 sentences from the instructor on what they'll work on together next
- No greeting, no sign-off, 3 paragraphs`,
        },
      ],
    });

    const llmBody = (response.content[0] as { type: 'text'; text: string }).text.trim();

    // Greeting
    const greeting = guardianName
      ? `Dear ${guardianName},`
      : 'Dear LEAGUE Family,';

    // Attendance section
    const attendanceSection = attendanceDates.length > 0
      ? `Class sessions attended (${monthLabel}):\n${attendanceDates.map((d) => `• ${d}`).join('\n')}`
      : '';

    // GitHub links section
    const repoLinks = [...repoData.entries()]
      .map(([fullRepo, { shortName }]) =>
        `• <a href="https://github.com/${fullRepo}" style="color:#f37121;text-decoration:none;">${shortName}</a> — github.com/${fullRepo}`,
      )
      .join('\n');

    const githubSection = `GitHub activity this past month (last 30 days):\n${repoLinks}`;

    // Sign-off
    const signOff = `Warm regards,\n${instructorName}\n${instructorEmail}`;

    const parts = [greeting, '', llmBody];
    if (attendanceSection) parts.push('', attendanceSection);
    parts.push('', githubSection, '', signOff);

    const generatedBody = parts.join('\n');

    res.json({
      body: generatedBody,
      commitCount: totalCommits,
      repoCount: repoData.size,
    });
  } catch (err) {
    next(err);
  }
});
