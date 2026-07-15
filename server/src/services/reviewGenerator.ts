import { and, desc, eq, gte, lt } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';
import {
  monthlyReviews,
  students,
  instructors,
  users,
  studentAttendance,
  pike13Tokens,
  reviewTemplates,
  quizzes,
  quizLessons,
  quizAttempts,
} from '../db/schema';
import { sendPike13Note, buildPike13NoteText } from './pike13Notes';
import { sendReviewEmail } from './email';
import { isLeagueRepoName, leagueOrgPrefix } from './github';

/**
 * A deliberate, user-actionable error raised while generating a review draft
 * (e.g. the student has no linked GitHub username, or there's no push activity
 * for the month). Carries a 400 status so the error handler shows the message
 * to the instructor instead of a generic "Internal server error".
 */
export class ReviewInputError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ReviewInputError';
  }
}

/**
 * Extract a valid GitHub username from a Pike13 custom-field value that may
 * contain trailing annotations (e.g. "jayden0511 (PW: hunter2)", "user:token",
 * "@name — note"). GitHub usernames are alphanumeric with single hyphens, so we
 * take the leading run of valid characters and drop anything a human appended.
 * Returns '' if no valid username can be recovered.
 */
export function sanitizeGithubUsername(raw: string): string {
  const beforeColon = raw.split(':')[0];
  const match = beforeColon.trim().replace(/^@/, '').match(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?/);
  return match ? match[0] : '';
}

/**
 * Strip Markdown emphasis and em dashes from AI-generated review text so the
 * parent-facing review is plain prose. The model is also instructed to avoid
 * these, but we enforce it defensively in case it slips.
 * - **bold** / __bold__ -> bold
 * - *italic* / _italic_ -> italic
 * - em dash / en dash -> a plain ", " or " - " where it reads naturally
 */
export function toPlainReviewText(text: string): string {
  return text
    // Bold: **x** or __x__
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // Italic: *x* or _x_ (single markers)
    .replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, '$1')
    .replace(/(?<![_\w])_([^_\n]+)_(?!\w)/g, '$1')
    // Em/en dashes surrounded by spaces -> a plain hyphen with spaces.
    .replace(/\s+[—–]\s+/g, ' - ')
    // Any remaining em/en dashes (no surrounding spaces) -> hyphen.
    .replace(/[—–]/g, '-');
}

/** A quiz the student completed for a lesson/module they worked on this month. */
export interface CompletedQuizInfo {
  lessonName: string;
  score: number;
  passed: boolean;
}

/**
 * Quiz coverage for the lessons/modules a student worked on during the review
 * period. `missing` lists the curriculum positions the student has advanced
 * through that have NO completed quiz — the instructor is warned they must have
 * the student take it. `completed` lists quizzes already taken, whose results
 * are folded into the parent-facing review.
 */
export interface QuizStatus {
  completed: CompletedQuizInfo[];
  missing: string[];
}

export interface GeneratedDraft {
  body: string;
  commitCount: number;
  repoCount: number;
  quizStatus: QuizStatus;
}

/**
 * Normalize a lesson/module label to a comparable token so GitHub-derived names
 * (e.g. "Level1-Module0", "30_Loops", "Loops") match quiz-bank lesson names
 * (e.g. "Level1 Module0", "30_Loops"). Lowercased, alphanumerics only.
 */
function quizMatchToken(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Look up the student's completed quizzes and reconcile them against the set of
 * curriculum positions (lesson/module labels) they worked on this review period.
 *
 * A completed quiz whose lesson matches a worked-on position is reported so the
 * result can be included in the parent review. Any worked-on position WITHOUT a
 * completed quiz is reported as `missing` so the instructor is prompted to have
 * the student take it before moving on.
 */
export async function getQuizStatus(studentId: number, workedOnLabels: string[]): Promise<QuizStatus> {
  const workedTokens = new Map<string, string>(); // token -> display label
  for (const label of workedOnLabels) {
    const tok = quizMatchToken(label);
    if (tok) workedTokens.set(tok, label);
  }
  if (workedTokens.size === 0) return { completed: [], missing: [] };

  // All quizzes for this student, with lesson name and latest attempt score.
  const rows = await db
    .select({
      status: quizzes.status,
      lessonName: quizLessons.name,
      score: quizAttempts.score,
      passed: quizAttempts.passed,
      submittedAt: quizAttempts.submittedAt,
    })
    .from(quizzes)
    .innerJoin(quizLessons, eq(quizzes.lessonId, quizLessons.id))
    .leftJoin(quizAttempts, eq(quizAttempts.quizId, quizzes.id))
    .where(eq(quizzes.studentId, studentId))
    .orderBy(desc(quizAttempts.submittedAt));

  // Best (most recent) completed attempt per lesson token.
  const completedByToken = new Map<string, CompletedQuizInfo>();
  for (const r of rows) {
    if (r.status !== 'completed' || r.score === null || r.score === undefined) continue;
    const tok = quizMatchToken(r.lessonName);
    if (!completedByToken.has(tok)) {
      completedByToken.set(tok, { lessonName: r.lessonName, score: r.score, passed: Boolean(r.passed) });
    }
  }

  const completed: CompletedQuizInfo[] = [];
  const missing: string[] = [];
  for (const [tok, label] of workedTokens) {
    const done = completedByToken.get(tok);
    if (done) completed.push(done);
    else missing.push(label);
  }
  return { completed, missing };
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

// Maps lowercased (no-space) placeholder names to their canonical camelCase form.
// Handles typos like {{studentname}}, {{StudentName}}, {{student name}}, etc.
const CANONICAL_PLACEHOLDER_NAMES: Record<string, string> = {
  studentname: 'studentName',
  guardianname: 'guardianName',
  month: 'month',
  instructorname: 'instructorName',
  instructoremail: 'instructorEmail',
  attendancesummary: 'attendanceSummary',
  githubsummary: 'githubSummary',
  progress: 'progress',
  highlights: 'highlights',
  instructornotes: 'instructorNotes',
};

// Normalizes placeholder formatting: collapses spaces and fixes casing.
// "{{student name}}" → "{{studentName}}", "{{studentname}}" → "{{studentName}}"
function normalizePlaceholders(text: string): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    const parts = key.trim().split(/\s+/);
    const camel = parts[0] + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join('');
    return '{{' + (CANONICAL_PLACEHOLDER_NAMES[camel.toLowerCase()] ?? camel) + '}}';
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

  const lower = sanitizeGithubUsername(githubUsername).toLowerCase();
  const matches = rows.filter((r) => {
    const stored = sanitizeGithubUsername(r.githubUsername ?? '').toLowerCase();
    return stored !== '' && stored === lower;
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

  if (!row) throw new ReviewInputError('Review not found');
  if (!row.githubUsername) throw new ReviewInputError('This student has no GitHub username linked in Pike13');

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
  const githubUsername = sanitizeGithubUsername(row.githubUsername);
  if (!githubUsername) {
    throw new ReviewInputError(
      `This student's GitHub username ("${row.githubUsername}") is not a valid username. Fix the GitHub field in Pike13.`,
    );
  }
  const month = review.month;
  const [yr, mo] = month.split('-');
  const monthLabel = new Date(Date.UTC(parseInt(yr), parseInt(mo) - 1, 15)).toLocaleString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });

  // Scope GitHub activity to the review's selected month rather than a rolling
  // 30-day window. The instructor picks the month when creating the review, so
  // the draft should cover that calendar month (e.g. all of May, not the trailing
  // 30 days). Boundaries are computed in UTC to match GitHub's event timestamps.
  const now = new Date();
  const since = new Date(Date.UTC(parseInt(yr), parseInt(mo) - 1, 1));
  const monthEndUtc = new Date(Date.UTC(parseInt(yr), parseInt(mo), 1));
  // Don't look past the end of the month, and never into the future (for an
  // in-progress current month, cap the window at "now").
  const until = monthEndUtc < now ? monthEndUtc : now;

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
    if (page === 1 && pageRes.status === 404) throw new ReviewInputError(`GitHub user "${githubUsername}" not found`);
    if (!pageRes.ok) break;
    const pageEvents = (await pageRes.json()) as GithubEvent[];
    if (pageEvents.length === 0) break;
    allEvents.push(...pageEvents);
    // Stop early once we've paged past the start of the review month
    const oldest = pageEvents[pageEvents.length - 1];
    if (new Date(oldest.created_at) < since) break;
  }

  const pushEvents = allEvents.filter((e) => {
    if (e.type !== 'PushEvent') return false;
    const d = new Date(e.created_at);
    return d >= since && d <= until;
  });
  if (pushEvents.length === 0) throw new ReviewInputError(`No GitHub push activity found for @${githubUsername} in ${monthLabel}`);

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
        `https://api.github.com/repos/${fullRepo}/commits?since=${since.toISOString()}&until=${until.toISOString()}&per_page=20`,
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
  // Shared LEAGUE-repo discovery logic (also used by the quiz completion gate).
  const orgPrefix = leagueOrgPrefix();

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
      const isLeague = ownerOrg.startsWith(orgPrefix) || parentOrg.startsWith(orgPrefix);
      if (!isLeague) repoData.delete(fullRepo);
    } catch { /* Can't verify — leave it in */ }
  }

  if (repoData.size === 0) throw new ReviewInputError(`No League curriculum repos found for @${githubUsername} in ${monthLabel}. The student may have push activity but only on personal repos.`);

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

  if (!commitSummary) throw new ReviewInputError(`No curriculum activity found for @${githubUsername} in ${monthLabel}`);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');

  const highestLessonName = lessonsSeen.get(highestLesson);
  const allLessonNames = [...lessonsSeen.entries()].sort(([a], [b]) => a - b).map(([, name]) => name);
  const lessonProgressNote = highestLessonName
    ? `Current curriculum position: working on "${highestLessonName}"${allLessonNames.length > 1 ? ` (also covered: ${allLessonNames.slice(0, -1).join(', ')})` : ''}.`
    : '';

  // Curriculum positions the student worked on this period, used to reconcile
  // against quizzes. Java repos are named per module (e.g. "Level1-Module0"),
  // which matches the Java quiz lesson names; Python lesson names come from the
  // parsed lessons/ paths. We include both so either curriculum matches.
  const workedOnLabels = Array.from(
    new Set([
      ...[...repoData.values()].map((r) => r.shortName),
      ...lessonsSeen.values(),
    ]),
  );
  const quizStatus = await getQuizStatus(review.studentId, workedOnLabels);

  // Completed quiz results are surfaced to the parent in the review; the model
  // is told about them so it can mention them naturally.
  const quizResultsNote = quizStatus.completed.length
    ? `Quiz results this period:\n${quizStatus.completed
        .map((q) => `• ${q.lessonName}: ${q.score}% (${q.passed ? 'passed' : 'not yet passed'})`)
        .join('\n')}`
    : '';

  const attendanceSection = attendanceDates.length > 0
    ? `Class sessions attended (${monthLabel}):\n${attendanceDates.map((d) => `• ${d}`).join('\n')}`
    : '';
  const repoLinks = [...repoData.entries()]
    .map(([fullRepo, { shortName }]) => `• ${shortName} — github.com/${fullRepo}`)
    .join('\n');
  const githubSection = `GitHub activity (${monthLabel}):\n${repoLinks}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const contextBlock = [
    `Student: ${studentName} | Month: ${monthLabel}`,
    attendanceDates.length > 0 ? `Attendance: ${attendanceDates.join(', ')} (${attendanceDates.length} session${attendanceDates.length === 1 ? '' : 's'})` : '',
    lessonProgressNote,
    quizResultsNote,
    '',
    `Curriculum activity (${monthLabel}):`,
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
      '{{instructorNotes}}': '2 to 4 sentences: one optional light suggestion framed as something to explore, then what the instructor plans to work on together next',
    };
    // Use simple keys (no braces) in the JSON contract so Claude returns them reliably.
    const sectionList = present.map((p) => `"${PLACEHOLDER_KEYS[p]}": ${placeholderDescriptions[p]}`).join('\n');

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You are an encouraging coding instructor writing sections of a monthly progress review for a parent/guardian.
Write in the FIRST PERSON as the instructor ("I", "me", "we"). Describe sessions from your own perspective, e.g. "${studentName} attended one session this month with me" or "we worked together on loops". Never write about the instructor in the third person.
Tone: warm, positive, encouraging. Never mention lesson numbers, use topic names (e.g. "loops", "functions").
Formatting: plain text only. Do NOT use Markdown, bold, italics, or em/en dashes; use commas or "and" instead.
Base everything ONLY on the data provided. Respond with ONLY a valid JSON object, no extra text.`,
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

    // Substitute AI placeholders with generated content (plain text enforced)
    let filled = template!;
    for (const p of present) {
      const rawValue = (sections as Record<string, string>)[PLACEHOLDER_KEYS[p]];
      const value = rawValue ? toPlainReviewText(rawValue) : `[${p} not generated]`;
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
- Write in the FIRST PERSON as the instructor. Use "I" and "me" and "we". When describing sessions the student attended, phrase it from your own perspective, e.g. "Anika attended one session this month with me" or "we worked together on loops". Do NOT write about the instructor in the third person.
- Warm, positive, and encouraging throughout — frame slow progress as steady, consistent growth
- Highlight the positives first and foremost
- Focus on the most advanced lessons the student worked on — these show where they are in the curriculum now
- Refer to lessons by their topic name (e.g. "loops", "functions", "classes") — NEVER by a number like "lesson 3" or "lesson 7"
- Only briefly mention earlier topics if they're directly relevant to understanding the advanced work
- Do NOT make high-achieving students feel they need to do more; keep any suggestions light and optional-sounding
- Base everything ONLY on the commit data and file paths provided; never invent details

Formatting rules (strict):
- Write in plain text only. Do NOT use Markdown.
- Do NOT use bold (**), italics (*), or any other emphasis markers.
- Do NOT use em dashes or en dashes. Use commas, periods, or the word "and" instead.

Structure (no headers, flowing paragraphs):
1. Progress paragraph — begin conversationally by introducing the report, e.g. "Here is ${studentName}'s progress report for the month of ${monthLabel}," then flow naturally into what they worked on, what topic they've reached, and what concepts that topic covers
2. Effort & highlights paragraph — specific things done well, how the work builds their skills
3. Instructor notes (2–4 sentences only) — one gentle suggestion for the student if helpful, then a brief plan for how the instructor will support them next. Keep this encouraging, never prescriptive.`,
      messages: [{
        role: 'user',
        content: `Write a monthly progress review for ${studentName} (${monthLabel}) to send to their parent/guardian.
${contextBlock}

Instructions:
- Write in the first person as the instructor ("I", "me", "we")
- Open the first paragraph conversationally by introducing the report, e.g. "Here is ${studentName}'s progress report for the month of ${monthLabel}," then continue into attendance and the topic they're currently working on (use the topic name, not a number)
- Describe attendance from your own perspective, e.g. "${studentName} attended one session this month with me" (or the correct session count)
- Lead with the most advanced topic work, not the earliest
- Keep any improvement suggestion light, one sentence max, framed as "something to explore" not a gap
- End with 2 to 3 sentences from the instructor on what they'll work on together next
- No greeting, no sign-off, 3 paragraphs
- Plain text only: no Markdown, no bold, no italics, no em dashes`,
      }],
    });

    // The LLM opens its first paragraph with the "Here is <student>'s progress
    // report for the month of <month>," intro in a conversational tone, so we
    // don't inject a separate opening line here.
    const llmBody = toPlainReviewText((message.content[0]?.type === 'text' ? message.content[0].text : '').trim());
    const greeting = guardianName ? `Dear ${guardianName},` : 'Dear LEAGUE Family,';
    const signOff = `Warm regards,\n${instructorName}\n${instructorEmail}`;
    const parts = [greeting, '', llmBody];
    if (attendanceSection) parts.push('', attendanceSection);
    if (quizResultsNote) parts.push('', quizResultsNote);
    parts.push('', githubSection, '', signOff);
    finalBody = parts.join('\n');
  }

  return { body: finalBody, commitCount: totalCommits, repoCount: repoData.size, quizStatus };
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
