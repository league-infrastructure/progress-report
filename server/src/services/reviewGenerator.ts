import { and, desc, eq, gte, lt } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';
import { monthlyReviews, students, instructors, users, studentAttendance, pike13Tokens, reviewTemplates } from '../db/schema';
import { sendPike13Note, buildPike13NoteText } from './pike13Notes';
import { sendReviewEmail } from './email';

export interface GeneratedDraft {
  body: string;
  commitCount: number;
  repoCount: number;
}

const AI_PLACEHOLDERS = ['{{progress}}', '{{highlights}}', '{{instructorNotes}}'] as const;
type AiPlaceholder = typeof AI_PLACEHOLDERS[number];

// Maps each AI placeholder to the simple JSON key used in the Claude prompt.
// Using simple keys avoids Claude returning different casing or omitting the braces.
const PLACEHOLDER_KEYS: Record<AiPlaceholder, string> = {
  '{{progress}}': 'progress',
  '{{highlights}}': 'highlights',
  '{{instructorNotes}}': 'instructorNotes',
};

function hasAiPlaceholders(text: string): boolean {
  return AI_PLACEHOLDERS.some((p) => text.includes(p));
}

// Normalizes whitespace inside {{ }} so "{{student name}}" → "{{studentName}}".
function normalizePlaceholders(text: string): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    const parts = key.trim().split(/\s+/);
    const camel = parts[0] + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join('');
    return '{{' + camel + '}}';
  });
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

/** Find a review by GitHub username (exact match, case-insensitive prefix before any colon). */
export async function findReviewByGithubUsername(
  githubUsername: string,
  month: string,
): Promise<{ reviewId: number; studentName: string } | { error: string }> {
  const rows = await db
    .select({
      reviewId: monthlyReviews.id,
      studentName: students.name,
      githubUsername: students.githubUsername,
    })
    .from(monthlyReviews)
    .innerJoin(students, eq(monthlyReviews.studentId, students.id))
    .where(eq(monthlyReviews.month, month));

  const lower = githubUsername.toLowerCase().replace(/^@/, '');
  const matches = rows.filter((r) => {
    const stored = (r.githubUsername ?? '').split(':')[0].trim().toLowerCase();
    return stored === lower;
  });

  if (matches.length === 0) return { error: `No student found with GitHub username "@${githubUsername}" for ${month}` };
  return { reviewId: matches[0].reviewId, studentName: matches[0].studentName };
}

/** Generate a review draft body from GitHub activity + Claude. */
export async function generateReviewDraft(reviewId: number, template?: string): Promise<GeneratedDraft> {
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

  // If no template was passed (e.g. from Slack bot/command), use the instructor's
  // most recently updated template so the Slack paths benefit from template-guided generation.
  if (!template) {
    const [tpl] = await db
      .select({ body: reviewTemplates.body })
      .from(reviewTemplates)
      .where(eq(reviewTemplates.instructorId, row.review.instructorId))
      .orderBy(desc(reviewTemplates.updatedAt))
      .limit(1);
    if (tpl) template = tpl.body;
  }

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

  interface GithubEvent {
    type: string;
    created_at: string;
    repo: { name: string };
    payload: { ref?: string; commits?: Array<{ sha: string; message: string }> };
  }
  interface EnrichedCommit { sha: string; fullSha: string; message: string; filesChanged: string[]; additions: number; deletions: number; }
  interface RepoData { shortName: string; commits: EnrichedCommit[]; }

  // Paginate the Events API — GitHub returns up to 10 pages of 100 events each.
  // A single page misses activity that's buried behind recent non-push events.
  const allEvents: GithubEvent[] = [];
  for (let page = 1; page <= 10; page++) {
    const pageRes = await fetch(
      `https://api.github.com/users/${encodeURIComponent(githubUsername)}/events?per_page=100&page=${page}`,
      { headers: ghHeaders },
    );
    if (page === 1 && pageRes.status === 404) throw new Error(`GitHub user "${githubUsername}" not found`);
    if (!pageRes.ok) break;
    const pageEvents = (await pageRes.json()) as GithubEvent[];
    if (pageEvents.length === 0) break;
    allEvents.push(...pageEvents);
    // Stop early if we've passed the 30-day window
    const oldest = pageEvents[pageEvents.length - 1];
    if (new Date(oldest.created_at) < since) break;
  }

  const pushEvents = allEvents.filter((e) => {
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
      if (!entry.commits.find((x) => x.fullSha === c.sha)) {
        entry.commits.push({ sha: (c.sha ?? '').slice(0, 7), fullSha: c.sha ?? '', message: msg, filesChanged: [], additions: 0, deletions: 0 });
      }
    }
  }

  // Fallback: PushEvent payload.commits can be empty (e.g. force-pushes or GitHub API quirk
  // where size/after are null). When a repo has push events but no commits from the payload,
  // fetch commits directly from the repo API using the since date — avoids the ?author= filter
  // issue and works for any push type.
  for (const [fullRepo, entry] of repoData) {
    if (entry.commits.length > 0) continue;
    try {
      const commitsRes = await fetch(
        `https://api.github.com/repos/${fullRepo}/commits?since=${since.toISOString()}&per_page=20`,
        { headers: ghHeaders },
      );
      if (!commitsRes.ok) continue;
      const commitsList = await commitsRes.json() as Array<{
        sha: string;
        commit: { message: string; author: { date: string } };
      }>;
      for (const c of commitsList) {
        const msg = (c.commit.message ?? '').split('\n')[0].trim();
        if (!msg || msg.toLowerCase().startsWith('merge ')) continue;
        if (!entry.commits.find((x) => x.fullSha === c.sha)) {
          entry.commits.push({ sha: c.sha.slice(0, 7), fullSha: c.sha, message: msg, filesChanged: [], additions: 0, deletions: 0 });
        }
      }
    } catch { /* skip */ }
  }

  // Filter to League curriculum repos only.
  // A repo is considered a League curriculum repo if ANY of the following are true:
  //   1. The repo name matches a known curriculum pattern (e.g. Level1-Module0, Python-Apprentice)
  //   2. The repo owner org starts with "league"
  //   3. The repo is a fork whose parent org starts with "league"
  // Fail-open: if the GitHub API check itself errors, keep the repo.
  const leagueOrgPrefix = (process.env.LEAGUE_GITHUB_ORG_PREFIX ?? 'league').toLowerCase();
  const LEAGUE_REPO_PATTERN = /^(level\d+[-_]module\d+|.*apprentice.*|.*league.*|.*curriculum.*)/i;

  const isLeagueRepoName = (shortName: string) => LEAGUE_REPO_PATTERN.test(shortName);

  for (const [fullRepo, { shortName }] of [...repoData.entries()]) {
    if (isLeagueRepoName(shortName)) continue; // Name match — keep without API call
    try {
      const repoRes = await fetch(`https://api.github.com/repos/${fullRepo}`, { headers: ghHeaders });
      if (!repoRes.ok) continue; // Can't verify — leave it in
      const info = await repoRes.json() as {
        fork: boolean;
        owner: { login: string };
        parent?: { owner: { login: string } };
      };
      const ownerOrg = info.owner.login.toLowerCase();
      const parentOrg = info.parent?.owner.login.toLowerCase() ?? '';
      const isLeague = ownerOrg.startsWith(leagueOrgPrefix) || parentOrg.startsWith(leagueOrgPrefix);
      if (!isLeague) repoData.delete(fullRepo);
    } catch { /* Can't verify — leave it in */ }
  }

  if (repoData.size === 0) throw new Error(`No League curriculum repos found for @${githubUsername} in the past 30 days. The student may have push activity but only on personal repos.`);

  // Enrich commits with file details using SHAs already known from Events API.
  // Avoids the ?author= filter on the commits list endpoint, which silently returns
  // nothing when the student's git config email doesn't match their GitHub login.
  for (const [fullRepo, entry] of repoData) {
    for (const commit of entry.commits.slice(0, 8)) {
      if (!commit.fullSha) continue;
      try {
        const detailRes = await fetch(
          `https://api.github.com/repos/${fullRepo}/commits/${commit.fullSha}`,
          { headers: ghHeaders },
        );
        if (!detailRes.ok) continue;
        const detail = await detailRes.json() as {
          stats?: { additions: number; deletions: number };
          files?: Array<{ filename: string }>;
        };
        commit.filesChanged = (detail.files ?? []).map((f) => f.filename);
        commit.additions = detail.stats?.additions ?? 0;
        commit.deletions = detail.stats?.deletions ?? 0;
      } catch { /* skip */ }
    }
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
  const isNonInfraFile = (f: string) => !INFRA.test(f.split('/').pop() ?? f);

  let highestLesson = 0;
  const lessonsSeen = new Map<number, string>();
  let totalCommits = 0;

  // First pass: try to find lessons/-style files (Python/JS curriculum structure)
  let useLessonFilter = false;
  for (const [, { commits }] of repoData) {
    for (const c of commits) {
      if (c.filesChanged.some((f) => isLessonFile(f) && isNonInfraFile(f))) { useLessonFilter = true; break; }
    }
    if (useLessonFilter) break;
  }

  const commitSummary = [...repoData.entries()].slice(0, 3).map(([, { shortName, commits }]) => {
    const lines: string[] = [];
    for (const c of commits.slice(0, 8)) {
      totalCommits++;
      const relevantFiles = useLessonFilter
        ? c.filesChanged.filter((f) => isLessonFile(f) && isNonInfraFile(f))
        : c.filesChanged.filter(isNonInfraFile);
      for (const f of relevantFiles) {
        if (useLessonFilter) {
          const n = lessonNumber(f);
          if (n !== null) { lessonsSeen.set(n, lessonName(f) ?? String(n)); if (n > highestLesson) highestLesson = n; }
        }
      }
      // If no relevant files were found, include the commit by message alone
      // so Claude can still write about the student's work.
      const stat = (c.additions || c.deletions) ? ` +${c.additions}/-${c.deletions}` : '';
      if (relevantFiles.length === 0) {
        lines.push(`  - ${c.message}${stat}`);
        continue;
      }
      const fileSummary = relevantFiles.slice(0, 4).map((f) => {
        if (useLessonFilter) {
          const parts = cleanLessonPath(f).split('/');
          const idx = parts.findIndex((p) => /^lessons?$/i.test(p));
          return idx >= 0 ? parts.slice(idx, idx + 3).join('/') : parts.slice(-2).join('/');
        }
        return f.split('/').slice(-2).join('/');
      }).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      lines.push(`  - ${c.message} [${fileSummary}]${stat}`);
    }
    if (lines.length === 0) return null;
    return `Repository: ${shortName}\n${lines.join('\n')}`;
  }).filter(Boolean).join('\n\n');

  if (!commitSummary) throw new Error(`No curriculum activity found for @${githubUsername} in the past 30 days`);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');

  const highestLessonName = lessonsSeen.get(highestLesson);
  const allLessonNames = [...lessonsSeen.entries()].sort(([a], [b]) => a - b).map(([, name]) => name);
  const lessonProgressNote = highestLessonName
    ? `Current curriculum position: working on "${highestLessonName}"${allLessonNames.length > 1 ? ` (also covered: ${allLessonNames.slice(0, -1).join(', ')})` : ''}.`
    : '';

  const attendanceSection = attendanceDates.length > 0
    ? `Class sessions attended (${monthLabel}):\n${attendanceDates.map((d) => `• ${d}`).join('\n')}`
    : '';
  const repoLinks = [...repoData.entries()]
    .map(([fullRepo, { shortName }]) => `• ${shortName} — github.com/${fullRepo}`)
    .join('\n');
  const githubSection = `GitHub activity this past month (last 30 days):\n${repoLinks}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const contextBlock = [
    `Student: ${studentName} | Month: ${monthLabel}`,
    attendanceDates.length > 0 ? `Attendance: ${attendanceDates.join(', ')} (${attendanceDates.length} session${attendanceDates.length === 1 ? '' : 's'})` : '',
    lessonProgressNote,
    '',
    'Curriculum activity (past 30 days):',
    commitSummary,
  ].filter(Boolean).join('\n');

  let finalBody: string;

  if (template && hasAiPlaceholders(template)) {
    // Normalize placeholder formatting (e.g. "{{student name}}" → "{{studentName}}")
    // before any substitution so user typos don't silently produce unfilled placeholders.
    template = normalizePlaceholders(template);

    // Template-guided generation: fill in only the AI placeholder sections
    const present = AI_PLACEHOLDERS.filter((p) => template!.includes(p));
    const placeholderDescriptions: Record<AiPlaceholder, string> = {
      '{{progress}}': 'A warm paragraph about what topics/concepts the student worked on this month',
      '{{highlights}}': 'A paragraph highlighting specific things the student did well and how it builds their skills',
      '{{instructorNotes}}': '2–4 sentences: one optional light suggestion framed as something to explore, then what the instructor plans to work on together next',
    };
    // Use simple keys (no braces) in the JSON contract so Claude returns them reliably.
    const sectionList = present.map((p) => `"${PLACEHOLDER_KEYS[p]}": ${placeholderDescriptions[p]}`).join('\n');

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You are an encouraging coding instructor writing sections of a monthly progress review for a parent/guardian.
Tone: warm, positive, encouraging. Never mention lesson numbers — use topic names (e.g. "loops", "functions").
Base everything ONLY on the data provided. Respond with ONLY a valid JSON object — no extra text.`,
      messages: [{
        role: 'user',
        content: `Fill in the following sections for the review. Respond with a JSON object containing only these keys:
${sectionList}

Student data:
${contextBlock}`,
      }],
    });

    const raw = (message.content[0]?.type === 'text' ? message.content[0].text : '').trim();
    let sections: Partial<Record<AiPlaceholder, string>> = {};
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      sections = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch { /* leave sections empty — fall back to placeholder text */ }

    // Substitute AI placeholders with generated content
    let filled = template!;
    for (const p of present) {
      const value = (sections as Record<string, string>)[PLACEHOLDER_KEYS[p]] ?? `[${p} not generated]`;
      filled = filled.replace(new RegExp(p.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    // Substitute data placeholders
    filled = filled
      .replace(/\{\{studentName\}\}/g, studentName)
      .replace(/\{\{guardianName\}\}/g, guardianName ?? 'LEAGUE Family')
      .replace(/\{\{month\}\}/g, monthLabel)
      .replace(/\{\{instructorName\}\}/g, instructorName)
      .replace(/\{\{instructorEmail\}\}/g, instructorEmail)
      .replace(/\{\{attendanceSummary\}\}/g, attendanceSection)
      .replace(/\{\{githubSummary\}\}/g, githubSection);

    finalBody = filled;
  } else {
    // Default free-form generation
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
3. Instructor notes (2–4 sentences only) — one gentle suggestion for the student if helpful, then a brief plan for how the instructor will support them next. Keep this encouraging, never prescriptive.`,
      messages: [{
        role: 'user',
        content: `Write a monthly progress review for ${studentName} (${monthLabel}) to send to their parent/guardian.
${contextBlock}

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
    const signOff = `Warm regards,\n${instructorName}\n${instructorEmail}`;
    const parts = [greeting, '', llmBody];
    if (attendanceSection) parts.push('', attendanceSection);
    parts.push('', githubSection, '', signOff);
    finalBody = parts.join('\n');
  }

  return { body: finalBody, commitCount: totalCommits, repoCount: repoData.size };
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
