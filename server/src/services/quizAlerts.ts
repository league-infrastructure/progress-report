import { and, count, eq, gte, lt, ne } from 'drizzle-orm';
import { db } from '../db';
import {
  studentAttendance,
  students,
  instructors,
  users,
  quizzes,
  quizLessons,
} from '../db/schema';
import { sendSlackDM } from './slack';

export interface QuizAlertResult {
  /** DMs successfully delivered. */
  sent: number;
  /** Instructors with alerts whose Slack account could not be found. */
  notFound: number;
  results: Array<{ instructorName: string; email: string; dmSent: boolean; studentCount: number }>;
}

interface StudentGap {
  studentId: number;
  studentName: string;
  /** Lesson names of this student's assigned-but-not-completed quizzes. */
  lessons: string[];
}

/**
 * Weekly sweep: for students who attended a session THIS month, find any quizzes
 * that are still `assigned` (never completed) and DM the instructor scheduled
 * with that student this month, warning that the quiz must be assigned/finished
 * before the work is considered complete.
 *
 * "Scheduled this month" = the instructor with the most attendance for that
 * student in the current month (tiebreak: most all-time), mirroring the monthly
 * review reminder's primary-instructor rule.
 *
 * `month` is a 'YYYY-MM' string; defaults to the current calendar month. The
 * scoping to the month is deliberate: we only nudge about students actively
 * being taught now, and we attribute them to their current instructor.
 */
export async function runQuizCompletionCheck(
  month: string = new Date().toISOString().slice(0, 7),
): Promise<QuizAlertResult> {
  const [year, mon] = month.split('-').map((n) => parseInt(n, 10));
  const monthStart = new Date(year, mon - 1, 1);
  const monthEnd = new Date(year, mon, 1);
  const appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');

  // Students with attendance this month, and per-instructor session counts.
  const monthlyRows = await db
    .select({
      studentId: studentAttendance.studentId,
      instructorId: studentAttendance.instructorId,
      n: count(),
    })
    .from(studentAttendance)
    .where(and(gte(studentAttendance.attendedAt, monthStart), lt(studentAttendance.attendedAt, monthEnd)))
    .groupBy(studentAttendance.studentId, studentAttendance.instructorId);

  if (monthlyRows.length === 0) return { sent: 0, notFound: 0, results: [] };

  // All-time counts for tie-breaking the "scheduled" instructor.
  const allTimeRows = await db
    .select({
      studentId: studentAttendance.studentId,
      instructorId: studentAttendance.instructorId,
      n: count(),
    })
    .from(studentAttendance)
    .groupBy(studentAttendance.studentId, studentAttendance.instructorId);

  const allTimeByStudent = new Map<number, Map<number, number>>();
  for (const r of allTimeRows) {
    if (!allTimeByStudent.has(r.studentId)) allTimeByStudent.set(r.studentId, new Map());
    allTimeByStudent.get(r.studentId)!.set(r.instructorId, Number(r.n));
  }

  // studentId -> Map<instructorId, monthlyCount>
  const monthlyByStudent = new Map<number, Map<number, number>>();
  for (const r of monthlyRows) {
    if (!monthlyByStudent.has(r.studentId)) monthlyByStudent.set(r.studentId, new Map());
    monthlyByStudent.get(r.studentId)!.set(r.instructorId, Number(r.n));
  }

  // Instructor scheduled with the student this month: highest monthly count,
  // tiebreak highest all-time count.
  function scheduledInstructorFor(studentId: number): number | null {
    const monthly = monthlyByStudent.get(studentId);
    if (!monthly || monthly.size === 0) return null;
    const allTime = allTimeByStudent.get(studentId);
    let best: number | null = null;
    let bestMonthly = -1;
    let bestAllTime = -1;
    for (const [instrId, monthlyCount] of monthly) {
      const allTimeCount = allTime?.get(instrId) ?? 0;
      if (monthlyCount > bestMonthly || (monthlyCount === bestMonthly && allTimeCount > bestAllTime)) {
        best = instrId;
        bestMonthly = monthlyCount;
        bestAllTime = allTimeCount;
      }
    }
    return best;
  }

  const scheduledStudentIds = [...monthlyByStudent.keys()];

  // Incomplete (assigned, never completed) quizzes for the scheduled students,
  // with their lesson names.
  const incompleteRows = await db
    .select({
      studentId: quizzes.studentId,
      studentName: students.name,
      lessonName: quizLessons.name,
    })
    .from(quizzes)
    .innerJoin(students, eq(quizzes.studentId, students.id))
    .innerJoin(quizLessons, eq(quizzes.lessonId, quizLessons.id))
    .where(ne(quizzes.status, 'completed'));

  // studentId -> gap (only for students scheduled this month)
  const scheduledSet = new Set(scheduledStudentIds);
  const gapByStudent = new Map<number, StudentGap>();
  for (const r of incompleteRows) {
    if (!scheduledSet.has(r.studentId)) continue;
    let gap = gapByStudent.get(r.studentId);
    if (!gap) {
      gap = { studentId: r.studentId, studentName: r.studentName, lessons: [] };
      gapByStudent.set(r.studentId, gap);
    }
    if (!gap.lessons.includes(r.lessonName)) gap.lessons.push(r.lessonName);
  }

  if (gapByStudent.size === 0) return { sent: 0, notFound: 0, results: [] };

  // Group gaps under the instructor scheduled with each student this month.
  const byInstructor = new Map<number, StudentGap[]>();
  for (const gap of gapByStudent.values()) {
    const instrId = scheduledInstructorFor(gap.studentId);
    if (instrId === null) continue;
    if (!byInstructor.has(instrId)) byInstructor.set(instrId, []);
    byInstructor.get(instrId)!.push(gap);
  }

  if (byInstructor.size === 0) return { sent: 0, notFound: 0, results: [] };

  // Resolve instructor names/emails.
  const instructorRows = await db
    .select({ id: instructors.id, name: users.name, email: users.email })
    .from(instructors)
    .innerJoin(users, eq(instructors.userId, users.id));
  const instructorById = new Map(instructorRows.map((i) => [i.id, i]));

  const results: QuizAlertResult['results'] = [];
  for (const [instrId, gaps] of byInstructor) {
    const instr = instructorById.get(instrId);
    if (!instr) continue;

    gaps.sort((a, b) => a.studentName.localeCompare(b.studentName));
    const lines = gaps.map((g) => `• *${g.studentName}* — ${g.lessons.join(', ')}`).join('\n');
    const text = [
      `:warning: *Quiz check-in* — you're scheduled with the following student${gaps.length === 1 ? '' : 's'} this month, and they have quizzes that still need to be completed before their work is considered complete:`,
      '',
      lines,
      '',
      `Assign or finish these quizzes here: ${appUrl}/instructor`,
    ].join('\n');

    let dmSent = false;
    try {
      dmSent = await sendSlackDM(instr.email, text);
    } catch {
      dmSent = false;
    }
    results.push({ instructorName: instr.name, email: instr.email, dmSent, studentCount: gaps.length });
  }

  return {
    sent: results.filter((r) => r.dmSent).length,
    notFound: results.filter((r) => !r.dmSent).length,
    results,
  };
}
