import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { db } from '../../server/src/db';
import { runQuizCompletionCheck } from '../../server/src/services/quizAlerts';

// These tests exercise the detection + grouping logic. Slack is not configured
// in the test env, so sendSlackDM returns false (no network); we assert on the
// returned `results` (which instructor is alerted, for how many students).

const MONTH = '2026-04';
const inApril = (day: number) => new Date(2026, 3, day); // month index 3 = April

let primaryInstrId: number;
let otherInstrId: number;
let studentA: number; // scheduled with primary, has incomplete quiz -> alert
let studentB: number; // scheduled with primary, all quizzes complete -> no alert
let studentC: number; // has incomplete quiz but NOT scheduled this month -> no alert
let levelId: number;
let lessonId: number;
let lesson2Id: number;

async function newInstructor(email: string, name: string): Promise<number> {
  const [u] = await db.insert(schema.users).values({ email, name }).returning();
  const [i] = await db.insert(schema.instructors).values({ userId: u.id, isActive: true }).returning();
  return i.id;
}

beforeAll(async () => {
  delete process.env.SLACK_BOT_TOKEN; // ensure Slack unconfigured

  primaryInstrId = await newInstructor('qa-primary@test.local', 'Primary Instr');
  otherInstrId = await newInstructor('qa-other@test.local', 'Other Instr');

  const [sA] = await db.insert(schema.students).values({ name: 'Quiz Student A' }).returning();
  const [sB] = await db.insert(schema.students).values({ name: 'Quiz Student B' }).returning();
  const [sC] = await db.insert(schema.students).values({ name: 'Quiz Student C' }).returning();
  studentA = sA.id; studentB = sB.id; studentC = sC.id;

  const [lvl] = await db.insert(schema.quizLevels).values({ slug: 'level-test-qa', name: 'Level Test', order: 1 }).returning();
  levelId = lvl.id;
  const [les] = await db.insert(schema.quizLessons).values({ levelId, name: 'Level3-Module2', module: 'M2', path: 'p', order: 1 }).returning();
  lessonId = les.id;
  const [les2] = await db.insert(schema.quizLessons).values({ levelId, name: 'Level3-Module3', module: 'M3', path: 'p2', order: 2 }).returning();
  lesson2Id = les2.id;

  // Attendance this month: A and B scheduled with primary; C is NOT scheduled this month.
  await db.insert(schema.studentAttendance).values([
    { studentId: studentA, instructorId: primaryInstrId, attendedAt: inApril(6), eventOccurrenceId: 'a1' },
    { studentId: studentA, instructorId: primaryInstrId, attendedAt: inApril(13), eventOccurrenceId: 'a2' },
    { studentId: studentB, instructorId: primaryInstrId, attendedAt: inApril(7), eventOccurrenceId: 'b1' },
  ]);

  // Quizzes: A has one incomplete (assigned) + one completed; B completed; C incomplete.
  await db.insert(schema.quizzes).values([
    { studentId: studentA, lessonId, status: 'assigned', questionIds: [] },
    { studentId: studentA, lessonId: lesson2Id, status: 'completed', questionIds: [] },
    { studentId: studentB, lessonId, status: 'completed', questionIds: [] },
    { studentId: studentC, lessonId, status: 'assigned', questionIds: [] },
  ]);
});

afterAll(async () => {
  await db.delete(schema.quizzes).where(inArray(schema.quizzes.studentId, [studentA, studentB, studentC]));
  await db.delete(schema.studentAttendance).where(inArray(schema.studentAttendance.studentId, [studentA, studentB, studentC]));
  await db.delete(schema.quizLessons).where(inArray(schema.quizLessons.id, [lessonId, lesson2Id]));
  await db.delete(schema.quizLevels).where(eq(schema.quizLevels.id, levelId));
  await db.delete(schema.students).where(inArray(schema.students.id, [studentA, studentB, studentC]));
  await db.delete(schema.instructors).where(inArray(schema.instructors.id, [primaryInstrId, otherInstrId]));
  await db.delete(schema.users).where(inArray(schema.users.email, ['qa-primary@test.local', 'qa-other@test.local']));
});

describe('runQuizCompletionCheck', () => {
  it('alerts only the scheduled instructor for students with an incomplete quiz', async () => {
    const result = await runQuizCompletionCheck(MONTH);

    // Exactly one instructor alerted: the primary, for exactly one student (A).
    const primary = result.results.find((r) => r.email === 'qa-primary@test.local');
    expect(primary).toBeDefined();
    expect(primary!.studentCount).toBe(1);
    // Slack not configured -> DM not sent, but the alert was computed.
    expect(primary!.dmSent).toBe(false);

    // The other instructor is not alerted at all.
    expect(result.results.some((r) => r.email === 'qa-other@test.local')).toBe(false);
  });

  it('does not alert about students with no attendance this month', async () => {
    // Student C has an incomplete quiz but no April attendance; must be excluded.
    const result = await runQuizCompletionCheck(MONTH);
    const totalStudents = result.results.reduce((n, r) => n + r.studentCount, 0);
    expect(totalStudents).toBe(1); // only student A
  });

  it('returns empty when no students attended the month', async () => {
    const result = await runQuizCompletionCheck('2020-01');
    expect(result.results).toEqual([]);
    expect(result.sent).toBe(0);
  });
});
