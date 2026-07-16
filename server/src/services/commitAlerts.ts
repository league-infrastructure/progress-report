import { count, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { studentAttendance, students, instructors, users } from '../db/schema';
import { sendSlackDM } from './slack';
import { hasLeagueCommitsInRange } from './github';
import { getScheduledStudentsThisWeek, weekBounds } from './quizAlerts';

export interface CommitAlertResult {
  sent: number;
  notFound: number;
  results: Array<{ instructorName: string; email: string; dmSent: boolean; studentCount: number }>;
}

/** Minimum recorded classes before the "must commit" rule applies. */
const NEW_STUDENT_ATTENDANCE_THRESHOLD = 2;

/**
 * Monday sweep: for each student scheduled with an instructor THIS week, check
 * whether they pushed any LEAGUE commit LAST week. If not, DM the instructor so
 * they can follow up. New students are exempt: a student with 2 or fewer total
 * recorded classes is skipped (they're just getting started).
 *
 * Students with no GitHub username are skipped here (that gap is surfaced on the
 * review page instead). GitHub API failures fail open (treated as "committed")
 * so a flaky API never produces a false "didn't commit" alert.
 *
 * `now` is injectable for tests; defaults to the current time.
 */
export async function runCommitCheck(now: Date = new Date()): Promise<CommitAlertResult> {
  const appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');

  // Last week's window: the 7 days before this week's start.
  const { weekStart } = weekBounds(now);
  const lastWeekEnd = weekStart;
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const scheduled = await getScheduledStudentsThisWeek(now);
  if (scheduled.size === 0) return { sent: 0, notFound: 0, results: [] };

  const studentIds = [...scheduled.keys()];

  // New-student exemption: total recorded classes per student.
  const attendanceCounts = await db
    .select({ studentId: studentAttendance.studentId, n: count() })
    .from(studentAttendance)
    .where(inArray(studentAttendance.studentId, studentIds))
    .groupBy(studentAttendance.studentId);
  const classesByStudent = new Map<number, number>();
  for (const r of attendanceCounts) classesByStudent.set(r.studentId, Number(r.n));

  // GitHub usernames for the scheduled students.
  const ghRows = await db
    .select({ id: students.id, githubUsername: students.githubUsername })
    .from(students)
    .where(inArray(students.id, studentIds));
  const githubById = new Map<number, string | null>();
  for (const r of ghRows) githubById.set(r.id, r.githubUsername);

  // instructorId -> students who didn't commit last week.
  const byInstructor = new Map<number, Array<{ studentName: string }>>();

  for (const s of scheduled.values()) {
    // Exempt brand-new students.
    if ((classesByStudent.get(s.studentId) ?? 0) <= NEW_STUDENT_ATTENDANCE_THRESHOLD) continue;

    const rawUsername = githubById.get(s.studentId);
    if (!rawUsername) continue; // no GitHub linked — handled elsewhere
    // Reuse the same sanitization the review generator uses for Pike13 values.
    const username = rawUsername.split(':')[0].trim().replace(/^@/, '').match(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?/)?.[0];
    if (!username) continue;

    let committed: { hasCommits: boolean; checked: boolean };
    try {
      committed = await hasLeagueCommitsInRange(username, lastWeekStart, lastWeekEnd);
    } catch {
      // GitHubUserNotFoundError etc. — skip rather than falsely flag.
      continue;
    }
    if (committed.hasCommits) continue; // committed (or couldn't verify) — no alert

    if (!byInstructor.has(s.instructorId)) byInstructor.set(s.instructorId, []);
    byInstructor.get(s.instructorId)!.push({ studentName: s.studentName });
  }

  if (byInstructor.size === 0) return { sent: 0, notFound: 0, results: [] };

  const instructorRows = await db
    .select({ id: instructors.id, name: users.name, email: users.email })
    .from(instructors)
    .innerJoin(users, eq(instructors.userId, users.id));
  const instructorById = new Map(instructorRows.map((i) => [i.id, i]));

  const results: CommitAlertResult['results'] = [];
  for (const [instrId, list] of byInstructor) {
    const instr = instructorById.get(instrId);
    if (!instr) continue;

    list.sort((a, b) => a.studentName.localeCompare(b.studentName));
    const lines = list.map((s) => `• *${s.studentName}*`).join('\n');
    const text = [
      `:warning: *Commit check* — the following student${list.length === 1 ? '' : 's'} you're scheduled with this week did not push any code last week. Please check in with them during class:`,
      '',
      lines,
      '',
      `Reviews: ${appUrl}/reviews`,
    ].join('\n');

    let dmSent = false;
    try {
      dmSent = await sendSlackDM(instr.email, text);
    } catch {
      dmSent = false;
    }
    results.push({ instructorName: instr.name, email: instr.email, dmSent, studentCount: list.length });
  }

  return {
    sent: results.filter((r) => r.dmSent).length,
    notFound: results.filter((r) => !r.dmSent).length,
    results,
  };
}
