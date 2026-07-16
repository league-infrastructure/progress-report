import { and, eq, gte, lt, ne } from 'drizzle-orm';
import { db } from '../db';
import {
  students,
  instructors,
  users,
  quizzes,
  quizLessons,
  volunteerEventSchedule,
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

/** Start (Sunday 00:00) and end (next Sunday 00:00) of the week containing `ref`, in local time. */
export function weekBounds(ref: Date): { weekStart: Date; weekEnd: Date } {
  const weekStart = new Date(ref);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // getDay(): 0 = Sunday
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return { weekStart, weekEnd };
}

/**
 * Weekly sweep: find students who have a quiz still `assigned` (never completed)
 * and DM the instructor scheduled with that student THIS WEEK, warning that the
 * quiz must be finished before the work is considered complete.
 *
 * Recipient = the instructor on this week's scheduled event(s) the student is
 * registered for (from `volunteer_event_schedule`, populated by the Pike13 sync
 * from upcoming event occurrences). This means if a student moved on last week
 * without testing, whoever has them scheduled this week gets the nudge.
 *
 * `now` is injectable for tests; defaults to the current time. Only quizzes with
 * status != 'completed' are considered.
 */
export async function runQuizCompletionCheck(
  now: Date = new Date(),
): Promise<QuizAlertResult> {
  const appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  const { weekStart, weekEnd } = weekBounds(now);

  // This week's scheduled events, each carrying its instructors and the students
  // registered for it.
  const scheduleRows = await db
    .select({
      instructors: volunteerEventSchedule.instructors,
      students: volunteerEventSchedule.students,
    })
    .from(volunteerEventSchedule)
    .where(and(gte(volunteerEventSchedule.startAt, weekStart), lt(volunteerEventSchedule.startAt, weekEnd)));

  if (scheduleRows.length === 0) return { sent: 0, notFound: 0, results: [] };

  // Resolve registered Pike13 person ids to local student ids. The schedule row
  // may already carry a studentId, but we resolve by pike13SyncId to stay correct
  // even for students created after the schedule row was written.
  const allStudents = await db
    .select({ id: students.id, name: students.name, pike13SyncId: students.pike13SyncId })
    .from(students);
  const studentByPike13 = new Map<string, { id: number; name: string }>();
  for (const s of allStudents) {
    if (s.pike13SyncId) studentByPike13.set(s.pike13SyncId, { id: s.id, name: s.name });
  }

  // studentId -> instructorId scheduled with them this week. If a student is in
  // multiple events, the last one wins (any scheduled instructor is a valid
  // recipient; overlap is surfaced separately in the review UI).
  const scheduledInstructorByStudent = new Map<number, number>();
  for (const row of scheduleRows) {
    const instrIds = (row.instructors ?? [])
      .map((i) => i.instructorId)
      .filter((id): id is number => id !== null);
    if (instrIds.length === 0) continue;
    for (const p of row.students ?? []) {
      const local = p.studentId != null
        ? { id: p.studentId }
        : studentByPike13.get(String(p.pike13Id));
      if (!local) continue;
      // Attribute to the first instructor on the event (co-taught events share one).
      scheduledInstructorByStudent.set(local.id, instrIds[0]);
    }
  }

  if (scheduledInstructorByStudent.size === 0) return { sent: 0, notFound: 0, results: [] };

  // Incomplete (assigned, never completed) quizzes with lesson names.
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

  // Keep only students scheduled this week, collecting their outstanding lessons.
  const gapByStudent = new Map<number, StudentGap>();
  for (const r of incompleteRows) {
    if (!scheduledInstructorByStudent.has(r.studentId)) continue;
    let gap = gapByStudent.get(r.studentId);
    if (!gap) {
      gap = { studentId: r.studentId, studentName: r.studentName, lessons: [] };
      gapByStudent.set(r.studentId, gap);
    }
    if (!gap.lessons.includes(r.lessonName)) gap.lessons.push(r.lessonName);
  }

  if (gapByStudent.size === 0) return { sent: 0, notFound: 0, results: [] };

  // Group gaps under the instructor scheduled with each student this week.
  const byInstructor = new Map<number, StudentGap[]>();
  for (const gap of gapByStudent.values()) {
    const instrId = scheduledInstructorByStudent.get(gap.studentId)!;
    if (!byInstructor.has(instrId)) byInstructor.set(instrId, []);
    byInstructor.get(instrId)!.push(gap);
  }

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
      `:warning: *Quiz check-in* — you're scheduled this week with the following student${gaps.length === 1 ? '' : 's'}, and they have quizzes that still need to be completed before their work is considered complete:`,
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
