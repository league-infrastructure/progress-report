import { and, eq, gte, lt } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';
import { monthlyReviews, students, instructors, users, studentAttendance, pike13Tokens } from '../db/schema';
import { sendPike13Note, buildPike13NoteText } from './pike13Notes';
import { sendReviewEmail } from './email';

export interface GeneratedDraft {
  body: string;
  commitCount: number;
  repoCount: number;
}

export interface ReviewSendRow {
  reviewId: number;
  studentName: string;
  guardianEmail: string | null;
  studentPike13Id: string | null;
  instructorName: string;
  instructorEmail: string;
  pike13AccessToken: string | null;
  month: string;
  body: string | null;
  feedbackToken: string;
  status: string;
}

/** Find a review by student name (case-insensitive partial match) and month. */
export async function findReviewByStudentName(
  nameFilter: string,
  month: string,
): Promise<{ reviewId: number; studentName: string } | { error: string }> {
  const rows = await db
    .select({
      reviewId: monthlyReviews.id,
      studentName: students.name,
    })
    .from(monthlyReviews)
    .innerJoin(students, eq(monthlyReviews.studentId, students.id))
    .where(eq(monthlyReviews.month, month));

  const lower = nameFilter.toLowerCase();
  const matches = rows.filter((r) => r.studentName.toLowerCase().includes(lower));

  if (matches.length === 0) return { error: `No student found matching "${nameFilter}" for ${month}` };
  if (matches.length > 1) {
    const names = matches.map((r) => r.studentName).join(', ');
    return { error: `Multiple students match "${nameFilter}": ${names}. Be more specific.` };
  }
  return matches[0];
}

/** Generate a review draft body from GitHub activity + Claude. */
export async function generateReviewDraft(reviewId: number): Promise<GeneratedDraft> {
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
    .where(eq(monthlyReviews.id, reviewId));

  if (!row) throw new Error('Review not found');
  if (!row.githubUsername) throw new Error('This student has no GitHub username linked in Pike13');

  const { studentName, guardianName, instructorName, instructorEmail, review } = row;
  const githubUsername = row.githubUsername.split(':')[0].trim();
  const month = review.month;
  const [yr, mo] = month.split('-');
  const monthLabel = new Date(Date.UTC(parseInt(yr), parseInt(mo) - 1, 15)).toLocaleString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });

  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const ghHeaders: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'LEAGUE-Review-App',
  };
  if (process.env.GITHUB_TOKEN) ghHeaders['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;

  const ghRes = await fetch(
    `https://api.github.com/users/${encodeURIComponent(githubUsername)}/events?per_page=100`,
    { headers: ghHeaders },
  );
  if (ghRes.status === 404) throw new Error(`GitHub user "${githubUsername}" not found`);
  if (!ghRes.ok) throw new Error(`GitHub API returned ${ghRes.status}`);

  interface GithubEvent {
    type: string;
    created_at: string;
    repo: { name: string };
    payload: { ref?: string; commits?: Array<{ sha: string; message: string }> };
  }
  interface EnrichedCommit { sha: string; message: string; filesChanged: string[]; additions: number; deletions: number; }
  interface RepoData { shortName: string; commits: EnrichedCommit[]; }

  const events = (await ghRes.json()) as GithubEvent[];
  const pushEvents = events.filter((e) => {
    if (e.type !== 'PushEvent') return false;
    const d = new Date(e.created_at);
    return d >= since && d <= now;
  });
  if (pushEvents.length === 0) throw new Error(`No GitHub push activity found for @${githubUsername} in the past 30 days`);

  const repoData = new Map<string, RepoData>();
  for (const event of pushEvents) {
    const fullRepo = event.repo.name;
    const shortName = fullRepo.split('/').pop() ?? fullRepo;
    if (!repoData.has(fullRepo)) repoData.set(fullRepo, { shortName, commits: [] });
    const entry = repoData.get(fullRepo)!;
    for (const c of event.payload.commits ?? []) {
      const msg = (c.message ?? '').split('\n')[0].trim();
      if (!msg || msg.toLowerCase().startsWith('merge ')) continue;
      if (!entry.commits.find((x) => x.message === msg)) {
        entry.commits.push({ sha: (c.sha ?? '').slice(0, 7), message: msg, filesChanged: [], additions: 0, deletions: 0 });
      }
    }
  }

  for (const [fullRepo, entry] of repoData) {
    try {
      const listRes = await fetch(
        `https://api.github.com/repos/${fullRepo}/commits?author=${encodeURIComponent(githubUsername)}&since=${since.toISOString()}&until=${now.toISOString()}&per_page=30`,
        { headers: ghHeaders },
      );
      if (!listRes.ok) continue;
      const list = await listRes.json() as Array<{ sha: string; commit: { message: string } }>;
      for (const c of list.slice(0, 5)) {
        const msg = c.commit.message.split('\n')[0].trim();
        if (!msg || msg.toLowerCase().startsWith('merge ')) continue;
        try {
          const detailRes = await fetch(`https://api.github.com/repos/${fullRepo}/commits/${c.sha}`, { headers: ghHeaders });
          if (!detailRes.ok) continue;
          const detail = await detailRes.json() as { stats?: { additions: number; deletions: number }; files?: Array<{ filename: string }> };
          const existing = entry.commits.find((x) => x.message === msg);
          const enriched: EnrichedCommit = {
            sha: c.sha.slice(0, 7), message: msg,
            filesChanged: (detail.files ?? []).map((f) => f.filename),
            additions: detail.stats?.additions ?? 0,
            deletions: detail.stats?.deletions ?? 0,
          };
          if (existing) Object.assign(existing, enriched);
          else if (entry.commits.length < 15) entry.commits.push(enriched);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  for (const [key, entry] of repoData) {
    if (entry.commits.length === 0) repoData.delete(key);
  }

  const reviewYear = parseInt(yr, 10);
  const reviewMon = parseInt(mo, 10);
  const monthStart = new Date(reviewYear, reviewMon - 1, 1);
  const monthEnd = new Date(reviewYear, reviewMon, 1);

  const attendanceRows = await db
    .select({ attendedAt: studentAttendance.attendedAt })
    .from(studentAttendance)
    .where(
      and(
        eq(studentAttendance.studentId, review.studentId),
        eq(studentAttendance.instructorId, review.instructorId),
        gte(studentAttendance.attendedAt, monthStart),
        lt(studentAttendance.attendedAt, monthEnd),
      ),
    )
    .orderBy(studentAttendance.attendedAt);

  const attendanceDates = attendanceRows.map((r) =>
    r.attendedAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
  );

  const INFRA = /^(dockerfile|docker-compose|\.dockerignore|requirements\.txt|pom\.xml|build\.gradle|\.gitignore|\.env|readme\.md|\.github|__pycache__|\.classpath|\.project|\.settings)/i;
  const isLessonFile = (f: string) => /(?:^|\/)lessons?\//i.test(f);
  const lessonNumber = (f: string) => { const m = f.match(/lessons?\/([\d]+)/i); return m ? parseInt(m[1], 10) : null; };
  const lessonName = (f: string) => { const m = f.match(/lessons?\/([^/]+)/i); if (!m) return null; return m[1].replace(/^\d+[_\-]?/, '').replace(/_/g, ' ').trim() || m[1]; };
  const cleanLessonPath = (f: string) => f.replace(/(lessons?\/)[\d]+[_\-]?/i, '$1');

  let highestLesson = 0;
  const lessonsSeen = new Map<number, string>();
  let totalCommits = 0;

  const commitSummary = [...repoData.entries()].slice(0, 3).map(([, { shortName, commits }]) => {
    const lines: string[] = [];
    for (const c of commits.slice(0, 8)) {
      totalCommits++;
      const lessonFiles = c.filesChanged.filter((f) => isLessonFile(f) && !INFRA.test(f.split('/').pop() ?? f));
      for (const f of lessonFiles) {
        const n = lessonNumber(f);
        if (n !== null) { lessonsSeen.set(n, lessonName(f) ?? String(n)); if (n > highestLesson) highestLesson = n; }
      }
      if (lessonFiles.length === 0) continue;
      const fileSummary = lessonFiles.slice(0, 4).map((f) => {
        const parts = cleanLessonPath(f).split('/');
        const idx = parts.findIndex((p) => /^lessons?$/i.test(p));
        return idx >= 0 ? parts.slice(idx, idx + 3).join('/') : parts.slice(-2).join('/');
      }).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      const stat = (c.additions || c.deletions) ? ` +${c.additions}/-${c.deletions}` : '';
      lines.push(`  - ${c.message} [${fileSummary}]${stat}`);
    }
    if (lines.length === 0) return null;
    return `Repository: ${shortName}\n${lines.join('\n')}`;
  }).filter(Boolean).join('\n\n');

  if (!commitSummary) throw new Error(`No curriculum (lessons/) activity found for @${githubUsername} in the past 30 days`);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');

  const highestLessonName = lessonsSeen.get(highestLesson);
  const allLessonNames = [...lessonsSeen.entries()].sort(([a], [b]) => a - b).map(([, name]) => name);
  const lessonProgressNote = highestLessonName
    ? `Current curriculum position: working on "${highestLessonName}"${allLessonNames.length > 1 ? ` (also covered: ${allLessonNames.slice(0, -1).join(', ')})` : ''}.`
    : '';

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
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
    messages: [{
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
    }],
  });

  const llmBody = (message.content[0]?.type === 'text' ? message.content[0].text : '').trim();
  const greeting = guardianName ? `Dear ${guardianName},` : 'Dear LEAGUE Family,';
  const attendanceSection = attendanceDates.length > 0
    ? `Class sessions attended (${monthLabel}):\n${attendanceDates.map((d) => `• ${d}`).join('\n')}`
    : '';
  const repoLinks = [...repoData.entries()]
    .map(([fullRepo, { shortName }]) => `• ${shortName} — github.com/${fullRepo}`)
    .join('\n');
  const githubSection = `GitHub activity this past month (last 30 days):\n${repoLinks}`;
  const signOff = `Warm regards,\n${instructorName}\n${instructorEmail}`;
  const parts = [greeting, '', llmBody];
  if (attendanceSection) parts.push('', attendanceSection);
  parts.push('', githubSection, '', signOff);

  return { body: parts.join('\n'), commitCount: totalCommits, repoCount: repoData.size };
}

/** Load everything needed to send a review. */
export async function loadReviewForSend(reviewId: number): Promise<ReviewSendRow> {
  const [row] = await db
    .select({
      reviewId: monthlyReviews.id,
      studentName: students.name,
      guardianEmail: students.guardianEmail,
      studentPike13Id: students.pike13SyncId,
      instructorName: users.name,
      instructorEmail: users.email,
      pike13AccessToken: pike13Tokens.accessToken,
      month: monthlyReviews.month,
      body: monthlyReviews.body,
      feedbackToken: monthlyReviews.feedbackToken,
      status: monthlyReviews.status,
    })
    .from(monthlyReviews)
    .innerJoin(students, eq(monthlyReviews.studentId, students.id))
    .innerJoin(instructors, eq(monthlyReviews.instructorId, instructors.id))
    .innerJoin(users, eq(instructors.userId, users.id))
    .leftJoin(pike13Tokens, eq(pike13Tokens.instructorId, instructors.id))
    .where(eq(monthlyReviews.id, reviewId));

  if (!row) throw new Error('Review not found');
  return row;
}

/** Mark a review as sent and deliver it via Pike13 or email. */
export async function sendReview(reviewId: number): Promise<void> {
  const row = await loadReviewForSend(reviewId);
  if (row.status === 'sent') return;

  const now = new Date();
  const [updated] = await db
    .update(monthlyReviews)
    .set({ status: 'sent', sentAt: now, updatedAt: now })
    .where(eq(monthlyReviews.id, reviewId))
    .returning();

  if (row.pike13AccessToken && row.studentPike13Id) {
    sendPike13Note({
      accessToken: row.pike13AccessToken,
      studentPike13Id: row.studentPike13Id,
      noteText: buildPike13NoteText({
        reviewBody: updated.body ?? '',
        studentName: row.studentName,
        month: updated.month,
        feedbackToken: updated.feedbackToken,
      }),
    }).catch((err) => console.error('Pike13 note delivery failed:', err));
  } else if (row.guardianEmail) {
    sendReviewEmail({
      toEmail: row.guardianEmail,
      studentName: row.studentName,
      month: updated.month,
      reviewBody: updated.body ?? '',
      feedbackToken: updated.feedbackToken,
    }).catch((err) => console.error('Email delivery failed:', err));
  }
}
